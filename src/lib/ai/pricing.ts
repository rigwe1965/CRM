/**
 * What Ivy costs, estimated from the token counts the API reports (AI_ASSISTANT_PLAN.md). The business pays Anthropic
 * directly with its own key, so this is only the basis for the monthly ceiling we enforce; Anthropic's invoice is the
 * source of truth. Change the table here when prices or the model change.
 */
export const IVY_MODEL = "claude-sonnet-5-5";

/** Dollars per million tokens, which is the same number as micro-dollars per token. */
type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };

export const PRICES: Record<string, Price> = {
  // Cache writes are billed at 1.25x the input price (5-minute cache); reads at a tenth.
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  // The model Anthropic's server-side fallback can switch to for some declined requests; same prices.
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
};

/** A model we have no price for (for example one a fallback switched to) is billed at the dearest price we know, never at zero. */
const dearest: Price = Object.values(PRICES).reduce(
  (m, p) => ({ input: Math.max(m.input, p.input), output: Math.max(m.output, p.output), cacheRead: Math.max(m.cacheRead, p.cacheRead), cacheWrite: Math.max(m.cacheWrite, p.cacheWrite) }),
  { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
);

export type TokenUsage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };

/** The usage block of an API response, with the cache fields the API leaves null when no cache was used. */
export function tokenUsage(u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }): TokenUsage {
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
}

/** Estimated cost of one call in millionths of a dollar, rounded up so many tiny calls can't add up to nothing. */
export function costMicros(model: string, u: TokenUsage): number {
  const p = PRICES[model] ?? dearest;
  return Math.ceil(u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite);
}

export const usd = (micros: number) => micros / 1_000_000;
