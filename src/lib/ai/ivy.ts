import Anthropic from "@anthropic-ai/sdk";
import { ApiError } from "@/lib/api";
import { IVY_MODEL, tokenUsage } from "@/lib/ai/pricing";
import { SYSTEM_PROMPT } from "@/lib/ai/prompt";
import { assertUnderCeiling } from "@/lib/ai/status";
import { TOOL_DEFINITIONS, ToolError, toolByName, type ToolContext } from "@/lib/ai/tools";
import { recordUsage } from "@/lib/ai/usage";

/**
 * One answer from Ivy (AI_ASSISTANT_PLAN.md, Phase 1). A hand-written loop rather than the SDK's tool runner, so every
 * model call is metered and checked against the business's spending ceiling before it is made. It never throws: every
 * outcome ends in `emit` events and a returned summary.
 */

/** Effort starts low (Anthropic's suggestion for chat); the eval set tells us if it should rise. */
export const IVY_EFFORT = "low" as const;
/** Includes the model's thinking as well as the answer, which both count towards this. */
export const MAX_TOKENS = 8000;
/** Tool rounds in one answer. After this Ivy says what it has so far instead of calling more. */
export const MAX_ROUNDS = 6;
/** Wall-clock budget for one answer, kept inside the host's function time limit (the chat route sets maxDuration to 60s). */
export const DEADLINE_MS = 50_000;
/** Anthropic's server-side fallback for requests its safety classifiers decline; needs this beta header. */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

type Param = Anthropic.Beta.BetaMessageParam;
type Block = Anthropic.Beta.BetaContentBlockParam;

export type IvyEvent =
  | { type: "conversation"; id: string; title: string }
  | { type: "text"; delta: string }
  | { type: "tool"; id: string; name: string; label: string; status: "start" | "done" | "error" }
  | { type: "done" }
  | { type: "error"; code: string; message: string };

/** What gets saved: the model's own content blocks, exactly as sent and received. */
export type StoredMessage = { role: "USER" | "ASSISTANT"; content: unknown };

export type IvyRun = { stopped: "answered" | "round_limit" | "deadline" | "refused" | "truncated" | "aborted" | "error"; rounds: number; tools: string[]; costMicros: number };

export async function runIvy(opts: {
  client: Pick<Anthropic, "beta">;
  ctx: ToolContext;
  conversationId: string;
  /** Earlier messages of this chat, as stored. */
  history: Param[];
  /** The new user turn: a context block (first turn only) and the question. */
  userBlocks: Block[];
  persist: (messages: StoredMessage[]) => Promise<void>;
  emit: (event: IvyEvent) => void;
  signal?: AbortSignal;
}): Promise<IvyRun> {
  const { client, ctx, conversationId, persist, emit, signal } = opts;
  const started = Date.now();
  const run: IvyRun = { stopped: "answered", rounds: 0, tools: [], costMicros: 0 };
  const messages: Param[] = [...opts.history, { role: "user", content: opts.userBlocks }];

  // Text from separate rounds is shown as separate paragraphs, as it is when the saved chat is rendered.
  let spoke = false;
  let breakBeforeNext = false;
  const say = (delta: string) => {
    if (breakBeforeNext) emit({ type: "text", delta: "\n\n" });
    breakBeforeNext = false;
    spoke = true;
    emit({ type: "text", delta });
  };
  const finish = (stopped: IvyRun["stopped"]) => ((run.stopped = stopped), run);
  /** Says something final in Ivy's own voice and saves it, so the saved chat ends in a complete turn. */
  const sayAndStop = async (text: string, stopped: IvyRun["stopped"]) => {
    say(text.trim());
    await persist([{ role: "ASSISTANT", content: [{ type: "text", text: text.trim() }] }]);
    emit({ type: "done" });
    return finish(stopped);
  };

  try {
    await persist([{ role: "USER", content: opts.userBlocks }]);

    for (;;) {
      if (signal?.aborted) return finish("aborted");
      if (run.rounds >= MAX_ROUNDS) {
        return await sayAndStop("\n\nI have looked up a lot already and need to stop here. Ask me a narrower question and I will continue from what I found.", "round_limit");
      }
      const remaining = DEADLINE_MS - (Date.now() - started);
      if (remaining <= 0) return await sayAndStop("\n\nThat is taking longer than I can allow. Ask me a narrower question and I will continue.", "deadline");

      // Checked before every model call, so a long answer stops at the ceiling instead of passing it.
      await assertUnderCeiling(ctx.user.tenantId, ctx.now);

      run.rounds++;
      const stream = client.beta.messages.stream(
        {
          model: IVY_MODEL,
          max_tokens: MAX_TOKENS,
          system: SYSTEM_PROMPT,
          tools: TOOL_DEFINITIONS as unknown as Anthropic.Beta.BetaToolUnion[],
          messages,
          output_config: { effort: IVY_EFFORT },
          cache_control: { type: "ephemeral" },
          betas: [FALLBACK_BETA],
          fallbacks: "default",
        },
        { signal, timeout: remaining },
      );
      stream.on("text", say);
      const message = await stream.finalMessage();

      // `message.model` is the model that actually answered, which differs from ours when the fallback ran.
      run.costMicros += await recordUsage({ tenantId: ctx.user.tenantId, userId: ctx.user.id, conversationId, model: message.model, usage: tokenUsage(message.usage) });

      if (message.stop_reason === "refusal") {
        emit({ type: "error", code: "AI_REFUSED", message: "Ivy cannot help with that request. Try asking about your contacts, deals, payments or stock." });
        return finish("refused");
      }
      const uses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (message.stop_reason === "max_tokens" && uses.length > 0) {
        // A cut-off tool call can still look valid, so none of it runs.
        emit({ type: "error", code: "AI_TOO_LONG", message: "That question needs more than Ivy can answer at once. Try a narrower question." });
        return finish("truncated");
      }
      if (message.stop_reason === "pause_turn" || (message.stop_reason !== "end_turn" && message.stop_reason !== "tool_use" && message.stop_reason !== "max_tokens")) {
        emit({ type: "error", code: "AI_FAILED", message: "Ivy could not finish that answer. Please try again." });
        return finish("error");
      }

      if (uses.length === 0) {
        await persist([{ role: "ASSISTANT", content: message.content }]);
        emit({ type: "done" });
        return finish(message.stop_reason === "max_tokens" ? "truncated" : "answered");
      }

      // Independent reads, so they run together; results go back in the order they were asked for.
      const toolCtx = { ...ctx, conversationId };
      const results = await Promise.all(uses.map((use) => runTool(toolCtx, use, emit)));
      run.tools.push(...uses.map((u) => u.name));
      const turn: StoredMessage[] = [
        { role: "ASSISTANT", content: message.content },
        { role: "USER", content: results },
      ];
      // The assistant turn and its results are saved together, so a saved chat never ends on a tool call with no result.
      await persist(turn);
      breakBeforeNext = spoke;
      messages.push({ role: "assistant", content: message.content as Block[] }, { role: "user", content: results });
    }
  } catch (e) {
    if (signal?.aborted || e instanceof Anthropic.APIUserAbortError) return finish("aborted");
    const { code, message } = explain(e);
    emit({ type: "error", code, message });
    return finish("error");
  }
}

async function runTool(ctx: ToolContext, use: Anthropic.Beta.BetaToolUseBlock, emit: (e: IvyEvent) => void): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  const tool = toolByName(use.name);
  if (!tool) return { type: "tool_result", tool_use_id: use.id, is_error: true, content: `There is no tool called ${use.name}. Use one of the tools you were given.` };
  emit({ type: "tool", id: use.id, name: use.name, label: tool.label(use.input), status: "start" });
  try {
    const text = await tool.run(ctx, use.input);
    emit({ type: "tool", id: use.id, name: use.name, label: tool.label(use.input), status: "done" });
    return { type: "tool_result", tool_use_id: use.id, content: text };
  } catch (e) {
    emit({ type: "tool", id: use.id, name: use.name, label: tool.label(use.input), status: "error" });
    // The model may correct its own mistakes, but never sees internal errors (queries, stack traces).
    if (e instanceof ToolError) return { type: "tool_result", tool_use_id: use.id, is_error: true, content: e.message };
    console.error("[ivy] tool failed", use.name, e instanceof Error ? e.message : e);
    return { type: "tool_result", tool_use_id: use.id, is_error: true, content: "That lookup failed. Try a different approach, or tell the person you could not get it." };
  }
}

/** A failure in words the person can act on. Never includes the key, the question or any record. */
export function explain(e: unknown): { code: string; message: string } {
  if (e instanceof ApiError) return { code: e.code ?? "AI_ERROR", message: e.message };
  if (e instanceof Anthropic.AuthenticationError) return { code: "AI_KEY_REJECTED", message: "Anthropic no longer accepts this business's key. An admin should replace it in Settings." };
  if (e instanceof Anthropic.PermissionDeniedError) return { code: "AI_KEY_REJECTED", message: "This business's Anthropic key is not allowed to use Ivy's model. An admin should check it in Settings." };
  if (e instanceof Anthropic.RateLimitError) return { code: "AI_PROVIDER_BUSY", message: "Anthropic is limiting this business's key right now. Try again in a minute." };
  if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(e.message)) {
    return { code: "AI_NO_CREDIT", message: "The Anthropic account behind this key has no credit left. An admin needs to add credit in the Anthropic console." };
  }
  if (e instanceof Anthropic.APIConnectionError) return { code: "AI_UNREACHABLE", message: "Could not reach Anthropic. Try again in a moment." };
  console.error("[ivy] failed", e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : e instanceof Error ? e.message : e);
  return { code: "AI_FAILED", message: "Ivy could not answer that. Please try again." };
}
