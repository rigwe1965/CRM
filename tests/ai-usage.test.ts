import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({ db: { aiUsage: { create: vi.fn(), aggregate: vi.fn() } } }));
vi.mock("@/lib/db", () => ({ db }));

import { IVY_MODEL } from "@/lib/ai/pricing";
import { ceilingState, monthStart, monthToDateMicros, nextMonthStart, recordUsage } from "@/lib/ai/usage";

describe("month boundaries", () => {
  it("count from the first of the month in UTC", () => {
    expect(monthStart(new Date("2026-10-30T23:59:59Z")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(nextMonthStart(new Date("2026-10-30T23:59:59Z")).toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("roll the year over in December", () => {
    expect(nextMonthStart(new Date("2026-12-31T12:00:00Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("use UTC, so a late-night local time near the boundary belongs to the same month for everyone", () => {
    expect(monthStart(new Date("2026-11-01T00:00:00Z")).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(monthStart(new Date("2026-10-31T23:59:59.999Z")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("ceilingState", () => {
  const ceiling = 10; // $10 = 10_000_000 micro-dollars

  it("is unset when there is no ceiling, whatever has been spent", () => {
    expect(ceilingState(null, 5_000_000)).toMatchObject({ level: "unset", ceilingUsd: null, percent: null, spentUsd: 5 });
  });

  it("is ok under 80%, warns from 80%, and is reached at 100%", () => {
    expect(ceilingState(ceiling, 0).level).toBe("ok");
    expect(ceilingState(ceiling, 7_999_999).level).toBe("ok");
    expect(ceilingState(ceiling, 8_000_000).level).toBe("warn");
    expect(ceilingState(ceiling, 9_999_999).level).toBe("warn");
    expect(ceilingState(ceiling, 10_000_000).level).toBe("reached");
    expect(ceilingState(ceiling, 12_000_000).level).toBe("reached");
  });

  it("reports a whole-number percentage, which can pass 100 when a call overshoots", () => {
    expect(ceilingState(ceiling, 2_500_000).percent).toBe(25);
    expect(ceilingState(ceiling, 12_000_000).percent).toBe(120);
  });

  it("handles cent-sized ceilings without float surprises", () => {
    expect(ceilingState(0.1, 99_999).level).toBe("warn");
    expect(ceilingState(0.1, 100_000).level).toBe("reached");
  });
});

describe("recording and summing usage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores tokens and an estimated cost for the business, and returns the cost", async () => {
    const cost = await recordUsage({
      tenantId: "t1",
      userId: "u1",
      conversationId: "c1",
      model: IVY_MODEL,
      usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 500, cacheWriteTokens: 0 },
    });
    expect(cost).toBe(Math.ceil(1000 * 2 + 100 * 10 + 500 * 0.2));
    expect(db.aiUsage.create).toHaveBeenCalledWith({
      data: { tenantId: "t1", userId: "u1", conversationId: "c1", model: IVY_MODEL, inputTokens: 1000, outputTokens: 100, cacheReadTokens: 500, cacheWriteTokens: 0, costMicros: cost },
    });
  });

  it("allows usage without a user or conversation", async () => {
    await recordUsage({ tenantId: "t1", model: IVY_MODEL, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } });
    expect(db.aiUsage.create.mock.calls[0][0].data).toMatchObject({ userId: null, conversationId: null });
  });

  it("sums this month's cost for one business only", async () => {
    db.aiUsage.aggregate.mockResolvedValue({ _sum: { costMicros: 4_200_000 } });
    expect(await monthToDateMicros("t1", new Date("2026-10-30T10:00:00Z"))).toBe(4_200_000);
    expect(db.aiUsage.aggregate).toHaveBeenCalledWith({ where: { tenantId: "t1", createdAt: { gte: new Date("2026-10-01T00:00:00Z") } }, _sum: { costMicros: true } });
  });

  it("is zero when nothing has been spent", async () => {
    db.aiUsage.aggregate.mockResolvedValue({ _sum: { costMicros: null } });
    expect(await monthToDateMicros("t1")).toBe(0);
  });
});
