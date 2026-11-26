import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import type { SessionUser } from "@/lib/auth-helpers";
import { ownerScope } from "@/lib/access";
import { normalizePhone } from "@/lib/phone";
import { anthropicFor } from "@/lib/ai/client";
import { tokenUsage } from "@/lib/ai/pricing";
import { modelFields } from "@/lib/ai/models";
import { appendMessages, loadConversation, MAX_MESSAGES, startConversation } from "@/lib/ai/conversations";
import { IVY_PROMPT_VERSION } from "@/lib/ai/prompt";
import { propose } from "@/lib/ai/proposals";
import { effectiveModel, loadAssistantSettings } from "@/lib/ai/settings";
import { recordUsage } from "@/lib/ai/usage";
import { reserveDocument } from "@/lib/ai/documents/reserve";
import { ToolError } from "@/lib/ai/tools/types";
import { assertCanReadDocument } from "@/lib/ai/documents/invoice";
import type { DocumentFile } from "@/lib/ai/documents/file";
import { MAX_ORDER_ITEMS, ORDER_PROMPT, ORDER_TOOL, orderDraft, readOrderInput, type OrderDraft, type ReadOrder } from "@/lib/ai/documents/order-prompt";

/**
 * Reading a customer's order from a screenshot or photo into a Create a deal card (AI_ASSISTANT_PLAN.md, Phase 4b). The
 * model copies what the picture shows; this file does what must not be left to it: the gates, matching the customer
 * among the person's own contacts (never creating one), checking every figure, and making the card through the same
 * `propose` path as a typed request, so the person approves it exactly as they approve any other card. Nothing is saved
 * by reading and the picture is not kept. No text from the picture is ever put into the saved chat.
 */

export type OrderCandidate = { id: string; label: string };
export type OrderResult = {
  conversationId: string;
  /** card: a Create a deal card is waiting. pick_customer: no single clear customer, the person chooses. incomplete: something needed is not in the picture. */
  outcome: "card" | "pick_customer" | "incomplete";
  message: string;
  candidates: OrderCandidate[];
  /** With pick_customer: what to send back with the chosen customer. */
  draft: OrderDraft | null;
};

const cents = (n: number) => Math.round(n * 100);
const money = (n: number) => n.toFixed(2);
const itemTotal = (items: OrderDraft["items"]) => items.reduce((s, i) => s + cents(i.quantity * i.unitPrice), 0) / 100;

/** Pure: turns what the model copied into a draft with every price present, or the reasons it cannot be one. Reasons mention item numbers, never the picture's own words. */
export function buildOrder(r: ReadOrder): { draft: OrderDraft | null; blocking: string[]; warnings: string[] } {
  const blocking: string[] = [];
  const warnings: string[] = [];
  if (r.items.length === 0) blocking.push("No product with a quantity could be read.");
  if (r.items.length > MAX_ORDER_ITEMS) blocking.push(`The order has more than ${MAX_ORDER_ITEMS} items, which is more than a deal card holds.`);
  const currency = r.currency && /^[A-Za-z]{3}$/.test(r.currency) ? r.currency.toUpperCase() : null;
  if (!currency) blocking.push("The currency is not shown.");
  const unpriced = r.items.map((i, n) => (i.unitPrice === undefined ? n + 1 : 0)).filter(Boolean);
  if (unpriced.length) blocking.push(`No price is shown for item ${unpriced.join(", item ")}.`);
  if (blocking.length) return { draft: null, blocking, warnings };

  const items = r.items.map((i) => ({ ...i, unitPrice: i.unitPrice as number }));
  const draft: OrderDraft = { currency: currency as string, items, ...(r.printedTotal !== undefined ? { printedTotal: r.printedTotal } : {}) };
  items.forEach((i, n) => i.unitPrice === 0 && warnings.push(`Item ${n + 1} has a price of 0. Check it.`));
  const total = itemTotal(items);
  if (r.printedTotal !== undefined && Math.abs(total - r.printedTotal) > 0.05 + 0.01 * items.length) {
    warnings.push(`The items add up to ${money(total)}, but the message shows a total of ${money(r.printedTotal)}. Something was misread or an item is missing: check every line against the message.`);
  }
  return { draft, blocking, warnings };
}

export type Found = { id: string; firstName: string; lastName: string; phone: string | null; phoneE164: string | null };
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((t) => t && t !== "-");
export const display = (c: Pick<Found, "firstName" | "lastName">) => [c.firstName, c.lastName].filter((p) => p && p !== "-").join(" ");
export const label = (c: Found) => {
  const digits = (c.phone ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? `${display(c)} (…${digits.slice(-4)})` : display(c);
};

/** Finds the customer among the person's own contacts: one clear match, or the few that could be meant. Never creates anything. */
export async function matchCustomer(user: SessionUser, who: { name?: string; phone?: string }): Promise<{ match: Found | null; by: "phone" | "name" | null; candidates: Found[] }> {
  const select = { id: true, firstName: true, lastName: true, phone: true, phoneE164: true };
  const base = { deletedAt: null, ...ownerScope(user) };
  const e164 = who.phone ? normalizePhone(who.phone) : null;
  const tokens = who.name ? norm(who.name) : [];

  const byPhone: Found[] = e164 ? await db.contact.findMany({ where: { ...base, phoneE164: e164 }, select, take: 5 }) : [];
  let byName: Found[] = [];
  let loose: Found[] = [];
  const long = tokens.filter((t) => t.length >= 3);
  if (tokens.length && long.length) {
    const pool: Found[] = await db.contact.findMany({
      where: { ...base, OR: long.flatMap((t) => [{ firstName: { equals: t, mode: "insensitive" as const } }, { lastName: { equals: t, mode: "insensitive" as const } }]) },
      select,
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    const want = [...tokens].sort().join(" ");
    byName = pool.filter((c) => [...norm(`${c.firstName} ${c.lastName}`)].sort().join(" ") === want);
    loose = pool;
  }

  if (byPhone.length === 1 && (byName.length === 0 || byName.some((c) => c.id === byPhone[0].id))) return { match: byPhone[0], by: "phone", candidates: [] };
  if (byPhone.length === 0 && byName.length === 1) return { match: byName[0], by: "name", candidates: [] };
  const seen = new Set<string>();
  const candidates = [...byPhone, ...byName, ...loose].filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true))).slice(0, 6);
  return { match: null, by: null, candidates };
}

/** Everything that decides whether this person may have an order read now: the document gates, and that cards can be made. */
export async function assertCanReadOrder(user: Pick<SessionUser, "id" | "tenantId"> & { tenantWritable?: boolean }, now = new Date()) {
  await assertCanReadDocument(user, now);
  const settings = await loadAssistantSettings(user.tenantId);
  if (settings.proposalsEnabled !== true) throw new ApiError(403, "Turning an order into a deal needs AI's proposed actions, which are switched off for this business. An admin can allow them in Settings, under AI assistant. You can still create the deal yourself.", "AI_PROPOSALS_OFF");
  if (user.tenantWritable === false) throw new ApiError(403, "This workspace is read-only until its subscription is renewed, so no deal can be created.", "TENANT_READ_ONLY");
}

/** The one request that reads an order. Exported so the quality check sends exactly what the app sends. */
export function orderRequest(file: DocumentFile, model?: string) {
  const data = Buffer.from(file.bytes).toString("base64");
  const source =
    file.mediaType === "application/pdf"
      ? ({ type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data } })
      : ({ type: "image" as const, source: { type: "base64" as const, media_type: file.mediaType, data } });
  return {
    ...modelFields(model),
    max_tokens: 8000,
    system: ORDER_PROMPT,
    tools: [ORDER_TOOL] as unknown as Anthropic.Beta.BetaToolUnion[],
    messages: [{ role: "user" as const, content: [source, { type: "text" as const, text: "Read this customer order." }] }],
  };
}

/** Opens the chat the card goes in: the person's current one, or a new one. */
export async function chatFor(user: SessionUser, conversationId: string | undefined) {
  if (!conversationId) return startConversation(user, "Order from a screenshot");
  const existing = await loadConversation(user, conversationId);
  if (!existing) throw new ApiError(404, "That conversation was not found.", "NOT_FOUND");
  if (existing.promptVersion !== IVY_PROMPT_VERSION) throw new ApiError(409, "This conversation was started with an older version of AI. Start a new chat to continue.", "AI_CONVERSATION_STALE");
  if (existing.messages.length + 2 > MAX_MESSAGES) throw new ApiError(409, "This conversation has reached its length limit. Start a new chat.", "AI_CONVERSATION_FULL");
  return existing;
}

const WARNING_LEAD = "Read from a picture of the customer's message: check every item, quantity and price against it before approving.";

/** Makes the Create a deal card for a checked draft and a chosen customer. Throws ApiError in words for the person. */
async function cardFor(user: SessionUser, conversationId: string, contactId: string, draft: OrderDraft, notes: string[], now: Date) {
  const contact = await db.contact.findFirst({ where: { id: contactId, deletedAt: null, ...ownerScope(user) }, select: { firstName: true, lastName: true } });
  if (!contact) throw new ApiError(404, "That customer was not found among your contacts.", "NOT_FOUND");
  try {
    await propose({ user, conversationId, now }, "DEAL_CREATE", { contactId, title: `Order for ${display(contact)}`.slice(0, 200), currency: draft.currency, items: draft.items }, { warning: [WARNING_LEAD, ...notes].join(" ") });
  } catch (e) {
    if (e instanceof ToolError) throw new ApiError(422, e.message, "AI_PROPOSAL_REFUSED");
    throw e;
  }
  return display(contact);
}

/** Reads one order picture. The call is recorded (and costed) whether or not it gave a usable answer. */
export async function readOrderFile(user: SessionUser, file: DocumentFile, opts: { conversationId?: string; now?: Date; client?: Pick<Anthropic, "beta">; gated?: boolean } = {}): Promise<OrderResult> {
  const now = opts.now ?? new Date();
  if (!opts.gated) await assertCanReadOrder(user, now);
  const chat = await chatFor(user, opts.conversationId); // before the paid call, so a stale chat costs nothing
  const client = opts.client ?? (await anthropicFor(user.tenantId));

  const release = await reserveDocument(user, now);
  const model = await effectiveModel(user.tenantId, user.id);
  let message;
  try {
    message = await client.beta.messages.create(orderRequest(file, model), { timeout: 55_000 });
  } catch (e) {
    console.error("[ivy-documents] order read failed", e instanceof Error ? e.message : e);
    await release();
    throw new ApiError(502, "AI could not read that picture just now. Try again in a moment, or create the deal yourself.", "AI_DOCUMENT_FAILED");
  }
  try {
    await recordUsage({ tenantId: user.tenantId, userId: user.id, model: message.model, usage: tokenUsage(message.usage), purpose: "DOCUMENT" });
  } finally {
    await release();
  }

  const use = message.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === ORDER_TOOL.name);
  const parsed = use ? readOrderInput.safeParse(use.input) : null;
  if (message.stop_reason === "max_tokens") throw new ApiError(422, "That message is too long for AI to read in one go. Send a shorter part of it, or create the deal yourself.", "AI_DOCUMENT_TOO_LONG");
  if (!parsed?.success) throw new ApiError(422, "AI could not make sense of that picture. Try a clearer screenshot, or create the deal yourself.", "AI_DOCUMENT_UNREADABLE");
  if (!parsed.data.readable) {
    throw new ApiError(422, `That does not look like a customer order AI can read${parsed.data.problem ? ` (${parsed.data.problem.slice(0, 200)})` : ""}. Try a clearer screenshot.`, "AI_DOCUMENT_UNREADABLE");
  }

  const { draft, blocking, warnings } = buildOrder(parsed.data);
  const finish = async (outcome: OrderResult["outcome"], text: string, candidates: Found[] = [], d: OrderDraft | null = null): Promise<OrderResult> => {
    // Only text the server wrote goes into the saved chat, never anything from the picture.
    await appendMessages(user.tenantId, chat.id, [
      { role: "USER", content: [{ type: "text", text: "I attached a screenshot of a customer's order." }] },
      { role: "ASSISTANT", content: [{ type: "text", text }] },
    ]);
    return { conversationId: chat.id, outcome, message: text, candidates: candidates.map((c) => ({ id: c.id, label: label(c) })), draft: d };
  };

  if (!draft) return finish("incomplete", `I read the order but cannot prepare a deal from it yet. ${blocking.join(" ")} Create the deal yourself, or ask me to create it and give me what is missing.`);

  const { match, by, candidates } = await matchCustomer(user, { name: parsed.data.customerName, phone: parsed.data.customerPhone });
  if (!match) {
    const text = candidates.length
      ? "I read the order, but I cannot tell for certain who it is from. Choose the customer and I will prepare the deal."
      : "I read the order, but I could not find the customer among your contacts. Add them as a contact first (I never create contacts silently), then attach the picture again.";
    return finish(candidates.length ? "pick_customer" : "incomplete", text, candidates, candidates.length ? draft : null);
  }
  const notes = [...warnings, ...(by === "name" ? ["The customer was matched by name only: check it is the right person."] : [])];
  const who = await cardFor(user, chat.id, match.id, draft, notes, now);
  return finish("card", `I read the order and prepared a deal for ${who}. Check it against the picture, then approve or decline the card below.${warnings.length ? " I found something to check: it is on the card." : ""}`);
}

/** The person chose the customer from the list: makes the card from the draft they were shown. The draft is checked again; it came back through the browser. */
export async function chooseCustomer(user: SessionUser, input: { conversationId: string; contactId: string; draft: unknown; now?: Date }): Promise<OrderResult> {
  const now = input.now ?? new Date();
  const checked = orderDraft.safeParse(input.draft);
  if (!checked.success) throw new ApiError(422, "That order could not be used. Attach the picture again.", "VALIDATION_ERROR");
  const chat = await chatFor(user, input.conversationId);
  const { warnings } = buildOrder({ readable: true, currency: checked.data.currency, printedTotal: checked.data.printedTotal, items: checked.data.items });
  const who = await cardFor(user, chat.id, input.contactId, checked.data, [...warnings, "You chose the customer from a list: check it is the right person."], now);
  const text = `I prepared the deal for ${who}. Check it, then approve or decline the card below.`;
  await appendMessages(user.tenantId, chat.id, [
    { role: "USER", content: [{ type: "text", text: `I chose ${who} as the customer.` }] },
    { role: "ASSISTANT", content: [{ type: "text", text }] },
  ]);
  return { conversationId: chat.id, outcome: "card", message: text, candidates: [], draft: null };
}
