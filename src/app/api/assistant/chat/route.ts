import { z } from "zod";
import { ApiError, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { isAdmin, ownerScope } from "@/lib/access";
import { keepTenant } from "@/lib/tenant-context";
import { anthropicFor } from "@/lib/ai/client";
import { appendMessages, loadConversation, MAX_MESSAGES, startConversation, toParams } from "@/lib/ai/conversations";
import { runIvy, type IvyEvent } from "@/lib/ai/ivy";
import { conversationContext, IVY_PROMPT_VERSION } from "@/lib/ai/prompt";
import { assertCanAsk } from "@/lib/ai/status";

export const dynamic = "force-dynamic";
// An answer can take several model calls; this is the host's function limit, and the loop keeps itself inside it (DEADLINE_MS).
export const maxDuration = 60;

const chatBody = z.object({
  conversationId: z.string().trim().min(1).max(40).optional(),
  message: z.string().trim().min(1, "Type a question").max(4000, "Keep it under 4,000 characters"),
});

/**
 * POST /api/assistant/chat { conversationId?, message }: asks Ivy a question and streams the answer as newline-delimited
 * JSON events (see IvyEvent in src/lib/ai/ivy.ts): `conversation`, then `text` and `tool` as it works, then `done` or
 * `error`. Any signed-in user; Ivy only reads what that user can see. Problems found before the stream starts (Ivy
 * off, no key, ceiling reached, rate limit, a stale or full chat) are ordinary error responses.
 */
export const POST = authed(async ({ req, user }) => {
  const body = await readBody(req, chatBody);
  await assertCanAsk(user);
  const client = await anthropicFor(user.tenantId);

  const existing = body.conversationId ? await loadConversation(user, body.conversationId) : null;
  if (body.conversationId && !existing) throw new ApiError(404, "That conversation was not found.", "NOT_FOUND");
  if (existing && existing.promptVersion !== IVY_PROMPT_VERSION) {
    throw new ApiError(409, "This conversation was started with an older version of Ivy. Start a new chat to continue.", "AI_CONVERSATION_STALE");
  }
  if (existing && existing.messages.length >= MAX_MESSAGES) throw new ApiError(409, "This conversation has reached its length limit. Start a new chat.", "AI_CONVERSATION_FULL");

  const convo = existing ?? (await startConversation(user, body.message));
  const history = existing ? toParams(existing.messages) : [];
  const userBlocks: { type: "text"; text: string }[] = [{ type: "text", text: body.message }];
  if (history.length === 0) {
    // Who is asking and today's date go in the first message, so the instructions themselves never change.
    const business = await db.tenant.findFirst({ where: { id: user.tenantId }, select: { name: true, brandName: true } });
    const context = conversationContext({
      today: new Date().toISOString().slice(0, 10),
      businessName: business?.brandName || business?.name || "the business",
      userName: user.name ?? "A user",
      role: user.role,
      sees: isAdmin(user) ? "all" : "own",
    });
    userBlocks.unshift({ type: "text", text: context });
  }

  // Metadata only: what they asked is not written to the audit log.
  await audit(user, { action: "assistant.ask", entity: "ai_conversation", entityId: convo.id, summary: `Asked Ivy (${body.message.length} characters)` }, req);

  // The answer streams after this handler has returned, so it has to re-enter the business itself.
  const inBusiness = keepTenant();
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: IvyEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The browser has gone away; the loop notices through the abort signal.
        }
      };
      emit({ type: "conversation", id: convo.id, title: convo.title });
      void inBusiness(() =>
        runIvy({
          client,
          ctx: { user, owned: ownerScope(user), now: new Date() },
          conversationId: convo.id,
          history,
          userBlocks,
          persist: (messages) => appendMessages(user.tenantId, convo.id, messages),
          emit,
          signal: abort.signal,
        }),
      )
        .catch((e) => {
          console.error("[ivy] run failed", e instanceof Error ? e.message : e);
          emit({ type: "error", code: "AI_FAILED", message: "Ivy could not answer that. Please try again." });
        })
        .finally(() => {
          try {
            controller.close();
          } catch {
            // Already closed by the browser.
          }
        });
    },
    cancel: () => abort.abort(),
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
});
