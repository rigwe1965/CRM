import { afterEach, describe, expect, it, vi } from "vitest";
import { flushWebhookStats, noteWebhookRejected } from "@/lib/webhook-stats";

afterEach(() => {
  flushWebhookStats();
  vi.restoreAllMocks();
});

describe("webhook rejection summary", () => {
  it("logs one line per minute with counts per kind and reason, and nothing when nothing was rejected", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    flushWebhookStats();
    expect(warn).not.toHaveBeenCalled();

    const t = 1_000_000;
    noteWebhookRejected("stripe", "bad_signature", t);
    noteWebhookRejected("stripe", "bad_signature", t + 1000);
    noteWebhookRejected("whatsapp", "throttled", t + 2000);
    expect(warn).not.toHaveBeenCalled(); // still inside the minute

    noteWebhookRejected("stripe", "bad_signature", t + 61_000); // the next minute starts: the old one is written
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("stripe:bad_signature=2");
    expect(String(warn.mock.calls[0][0])).toContain("whatsapp:throttled=1");
  });

  it("never logs a secret, signature or address", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    noteWebhookRejected("stripe", "bad_signature", 5);
    flushWebhookStats();
    expect(String(warn.mock.calls[0][0])).toBe("[webhook] rejected in the last minute: stripe:bad_signature=1");
  });
});
