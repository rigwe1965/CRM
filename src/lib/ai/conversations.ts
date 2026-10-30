import { Prisma } from "@prisma/client";
import type Anthropic from "@anthropic-ai/sdk";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { clip } from "@/lib/ai/tools/result";
import { IVY_PROMPT_VERSION, TOOL_CHIPS } from "@/lib/ai/prompt";
import type { StoredMessage } from "@/lib/ai/ivy";

/**
 * Saving and showing Ivy's chats. A chat belongs to one user and nobody else can open it, admins included: every
 * lookup names the business and the user. Messages are stored exactly as the model sent and received them.
 */

/** A chat ends after this many stored messages (a tool round is two), and the person starts a new one. */
export const MAX_MESSAGES = 40;

type Who = { id: string; tenantId: string };
type Row = { role: "USER" | "ASSISTANT"; content: unknown };

export async function startConversation(user: Who, firstQuestion: string) {
  const c = await db.aiConversation.create({
    data: { tenantId: user.tenantId, userId: user.id, title: clip(firstQuestion, 60) ?? "New conversation", promptVersion: IVY_PROMPT_VERSION },
    select: { id: true, title: true },
  });
  return c;
}

/** One of the user's own chats with its messages in order, or null. */
export async function loadConversation(user: Who, id: string) {
  return db.aiConversation.findFirst({
    where: { id, tenantId: user.tenantId, userId: user.id },
    select: { id: true, title: true, promptVersion: true, updatedAt: true, messages: { orderBy: { position: "asc" }, select: { role: true, content: true } } },
  });
}

/** Saves messages after the existing ones, together. Two answers racing on one chat collide on the position and the second is refused. */
export async function appendMessages(tenantId: string, conversationId: string, messages: StoredMessage[]) {
  const last = await db.aiMessage.aggregate({ where: { tenantId, conversationId }, _max: { position: true } });
  const first = (last._max.position ?? -1) + 1;
  try {
    await db.$transaction([
      ...messages.map((m, n) => db.aiMessage.create({ data: { tenantId, conversationId, position: first + n, role: m.role, content: m.content as Prisma.InputJsonValue } })),
      db.aiConversation.updateMany({ where: { id: conversationId, tenantId }, data: { updatedAt: new Date() } }),
    ]);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ApiError(409, "Ivy is still answering your last question. Wait for it to finish.", "AI_BUSY");
    throw e;
  }
}

export const listConversations = (user: Who) =>
  db.aiConversation.findMany({
    where: { tenantId: user.tenantId, userId: user.id },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: 30,
    select: { id: true, title: true, updatedAt: true },
  });

/** Removes one of the user's chats. The audit entry keeps only metadata: the title comes from what they asked, so it is not kept. */
export async function deleteConversation(user: Who & { email?: string | null }, id: string, req: Request) {
  const c = await db.aiConversation.findFirst({ where: { id, tenantId: user.tenantId, userId: user.id }, select: { id: true, createdAt: true, _count: { select: { messages: true } } } });
  if (!c) return false;
  await audit(user, { action: "assistant.conversation.deleted", entity: "ai_conversation", entityId: c.id, data: { createdAt: c.createdAt, messages: c._count.messages } }, req);
  await db.aiConversation.deleteMany({ where: { id, tenantId: user.tenantId, userId: user.id } });
  return true;
}

/** Stored messages back into what the API takes. */
export const toParams = (rows: Row[]) =>
  rows.map((r) => ({ role: r.role === "USER" ? "user" : "assistant", content: r.content })) as Anthropic.Beta.BetaMessageParam[];

export type RenderedMessage = { role: "user" | "assistant"; text: string; tools: string[] };

type StoredBlock = { type?: string; text?: string; name?: string };
const blocksOf = (content: unknown): StoredBlock[] => (Array.isArray(content) ? (content as StoredBlock[]) : typeof content === "string" ? [{ type: "text", text: content }] : []);

/**
 * What the panel shows for a saved chat: the person's own words, and each of Ivy's answers as one bubble (its text
 * across all tool rounds, plus a chip per lookup). Context blocks, thinking and raw tool results are never sent to the browser.
 */
export function renderMessages(rows: Row[]): RenderedMessage[] {
  const out: RenderedMessage[] = [];
  for (const row of rows) {
    const blocks = blocksOf(row.content);
    if (row.role === "USER") {
      const text = blocks.filter((b) => b.type === "text" && b.text && !b.text.startsWith("<context>")).map((b) => b.text).join("\n");
      if (text) out.push({ role: "user", text, tools: [] });
      continue;
    }
    const text = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    const tools = blocks.filter((b) => b.type === "tool_use" && b.name).map((b) => TOOL_CHIPS[b.name!] ?? "Looked something up");
    const prev = out[out.length - 1];
    if (prev?.role === "assistant") {
      prev.text = [prev.text, text].filter(Boolean).join("\n\n");
      prev.tools.push(...tools);
    } else {
      out.push({ role: "assistant", text, tools });
    }
  }
  return out;
}
