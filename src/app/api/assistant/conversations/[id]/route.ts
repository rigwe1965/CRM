import { ApiError, noContent, ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { deleteConversation, loadConversation, MAX_MESSAGES, renderMessages } from "@/lib/ai/conversations";
import { IVY_PROMPT_VERSION } from "@/lib/ai/prompt";

export const dynamic = "force-dynamic";

type P = { id: string };

/**
 * GET /api/assistant/conversations/:id: one of your own chats, ready to show: your questions, AI's answers and a chip per
 * lookup. `stale` means it was started under older instructions and can be read but not continued; `full` that it has
 * reached its length limit. Thinking, tool inputs and raw results are never sent.
 */
export const GET = authed<P>(async ({ user, params }) => {
  const c = await loadConversation(user, params.id);
  if (!c) throw new ApiError(404, "That conversation was not found.", "NOT_FOUND");
  return ok({ id: c.id, title: c.title, stale: c.promptVersion !== IVY_PROMPT_VERSION, full: c.messages.length >= MAX_MESSAGES, messages: renderMessages(c.messages) });
});

/** DELETE /api/assistant/conversations/:id: removes one of your own chats. The audit log keeps only that it happened. */
export const DELETE = authed<P>(async ({ req, user, params }) => {
  if (!(await deleteConversation(user, params.id, req))) throw new ApiError(404, "That conversation was not found.", "NOT_FOUND");
  return noContent();
});
