import type Anthropic from "@anthropic-ai/sdk";
import { ApiError } from "@/lib/api";
import { tokenUsage } from "@/lib/ai/pricing";
import { modelFields } from "@/lib/ai/models";
import { assertUnderCeiling } from "@/lib/ai/status";
import { recordUsage } from "@/lib/ai/usage";
import { clip } from "@/lib/ai/tools/result";
import { INBOX_PROMPT, INBOX_TOOL, writeSuggestionsInput } from "@/lib/ai/inbox/prompt";
import type { Candidate } from "@/lib/ai/inbox/rules";

/**
 * The daily inbox's only model step (AI_ASSISTANT_PLAN.md, Phase 3b): better words for a task title and a customer
 * message. The model is shown the candidates the rules chose and can return nothing but wording keyed to them. It cannot
 * pick a customer, a deal, an amount or a date, so the worst a hostile record can do is a badly worded title, which the
 * person sees on the card (and a draft is checked for links and numbers). Any failure, or a spent ceiling, returns no
 * wording at all and the cards use the plain templates, so the inbox never goes blank.
 */

export type Wording = { taskTitle: string; message?: string };

/** What the model sees about one candidate: facts and a flag for whether a message is wanted. Nothing identifying beyond a first name and the deal. */
function factSheet(c: Candidate) {
  return {
    key: c.key,
    rule: c.rule,
    customer: c.facts.customer,
    deal: c.facts.deal,
    amount: c.facts.amountText,
    daysLate: c.facts.daysLate,
    dueDate: c.facts.dueDate,
    wantsMessage: !!c.message,
    channel: c.message?.channel ?? null,
    recentSubjects: c.facts.recentSubjects.map((s) => clip(s, 80)),
  };
}

export async function writeWording(opts: {
  client: Pick<Anthropic, "beta">;
  tenantId: string;
  userId: string;
  candidates: Candidate[];
  now?: Date;
}): Promise<{ words: Map<string, Wording>; costMicros: number }> {
  const words = new Map<string, Wording>();
  const want = opts.candidates.filter((c) => c.task || c.message);
  if (want.length === 0) return { words, costMicros: 0 };
  try {
    const gate = await assertUnderCeiling(opts.tenantId, opts.now);
    const message = await opts.client.beta.messages.create(
      {
        ...modelFields(gate?.model),
        max_tokens: 3000,
        system: INBOX_PROMPT,
        tools: [INBOX_TOOL] as unknown as Anthropic.Beta.BetaToolUnion[],
        messages: [{ role: "user", content: [{ type: "text", text: `<candidates>\n${JSON.stringify(want.map(factSheet))}\n</candidates>` }] }],
      },
      { timeout: 40_000 },
    );
    const costMicros = await recordUsage({ tenantId: opts.tenantId, userId: opts.userId, model: message.model, usage: tokenUsage(message.usage), purpose: "INBOX" });
    const use = message.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === INBOX_TOOL.name);
    const parsed = use ? writeSuggestionsInput.safeParse(use.input) : null;
    if (parsed?.success && message.stop_reason !== "max_tokens") {
      const known = new Map(want.map((c) => [c.key, c]));
      for (const item of parsed.data.items) {
        const c = known.get(item.key);
        if (!c) continue; // a key it was not given is ignored
        words.set(item.key, {
          taskTitle: clip(item.taskTitle, 100) ?? "",
          // Only candidates that asked for a message get one.
          ...(c.message && item.message ? { message: item.message.trim() } : {}),
        });
      }
    }
    return { words, costMicros };
  } catch (e) {
    // A spent ceiling, a refusal, a timeout: no wording, so the plain templates are used.
    if (!(e instanceof ApiError)) console.error("[ivy-inbox] wording failed", e instanceof Error ? e.message : e);
    return { words: new Map(), costMicros: 0 };
  }
}
