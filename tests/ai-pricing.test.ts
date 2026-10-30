import { describe, expect, it } from "vitest";
import { costMicros, IVY_MODEL, PRICES, tokenUsage, usd } from "@/lib/ai/pricing";

describe("tokenUsage", () => {
  it("reads the API's usage block, treating missing cache fields as zero", () => {
    expect(tokenUsage({ input_tokens: 10, output_tokens: 5 })).toEqual({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(tokenUsage({ input_tokens: 1, output_tokens: 2, cache_read_input_tokens: null, cache_creation_input_tokens: 7 })).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheWriteTokens: 7,
    });
  });
});

describe("costMicros", () => {
  it("prices Sonnet 5.5 at $2 in and $10 out per million tokens", () => {
    expect(costMicros(IVY_MODEL, { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(2_000_000);
    expect(costMicros(IVY_MODEL, { inputTokens: 0, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(10_000_000);
  });

  it("prices cache reads at a tenth of input and cache writes at 1.25x", () => {
    expect(costMicros(IVY_MODEL, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 })).toBe(200_000);
    expect(costMicros(IVY_MODEL, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 1_000_000 })).toBe(2_500_000);
  });

  it("estimates a typical question at a couple of cents", () => {
    const cost = usd(costMicros(IVY_MODEL, { inputTokens: 8000, outputTokens: 800, cacheReadTokens: 0, cacheWriteTokens: 0 }));
    expect(cost).toBeGreaterThan(0.01);
    expect(cost).toBeLessThan(0.05);
  });

  it("rounds up, so a tiny call is never free", () => {
    expect(costMicros(IVY_MODEL, { inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(2);
    expect(costMicros(IVY_MODEL, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1, cacheWriteTokens: 0 })).toBe(1);
  });

  it("bills a model it has no price for at the dearest price it knows, never at zero", () => {
    const u = { inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(PRICES["claude-made-up-model"]).toBeUndefined();
    expect(costMicros("claude-made-up-model", u)).toBeGreaterThan(0);
    expect(costMicros("claude-made-up-model", u)).toBeGreaterThanOrEqual(costMicros(IVY_MODEL, u));
  });
});

describe("usd", () => {
  it("converts micro-dollars to dollars", () => expect(usd(2_500_000)).toBe(2.5));
});
