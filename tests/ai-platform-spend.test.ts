import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { platformDb, trySendMail } = vi.hoisted(() => ({
  platformDb: {
    aiUsage: { aggregate: vi.fn(), groupBy: vi.fn() },
    aiCredit: { groupBy: vi.fn() },
    tenant: { findMany: vi.fn() },
  },
  trySendMail: vi.fn(),
}));
vi.mock("@/lib/platform-db", () => ({ platformDb }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/mail", () => ({ appUrl: () => "https://crm.test", trySendMail }));

import { alertConfig, buildSpendReport, formatSpendReport, runDailyPlatformAiCheck, spendAlertEmail, tiersCrossed } from "@/lib/ai/platform-spend";

const M = 1_000_000;
const agg = (cost: number, credit = 0, calls = 1) => ({ _sum: { costMicros: cost * M, creditMicros: credit * M }, _count: calls });

beforeEach(() => {
  vi.clearAllMocks();
  trySendMail.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());

describe("alertConfig", () => {
  it("needs both a positive dollar limit and an email", () => {
    expect(alertConfig({ INCLUDED_AI_ALERT_USD: "50", INCLUDED_AI_ALERT_EMAIL: "me@x.test" })).toEqual({ limitMicros: 50 * M, to: "me@x.test" });
    expect(alertConfig({ INCLUDED_AI_ALERT_USD: "50" })).toBeNull();
    expect(alertConfig({ INCLUDED_AI_ALERT_EMAIL: "me@x.test" })).toBeNull();
    expect(alertConfig({ INCLUDED_AI_ALERT_USD: "0", INCLUDED_AI_ALERT_EMAIL: "me@x.test" })).toBeNull();
    expect(alertConfig({ INCLUDED_AI_ALERT_USD: "abc", INCLUDED_AI_ALERT_EMAIL: "me@x.test" })).toBeNull();
    expect(alertConfig({ INCLUDED_AI_ALERT_USD: "-5", INCLUDED_AI_ALERT_EMAIL: "me@x.test" })).toBeNull();
  });
});

describe("tiersCrossed", () => {
  const L = 100 * M;
  it("is empty while below 80%", () => expect(tiersCrossed(10 * M, 79 * M, L)).toEqual([]));
  it("fires 80% on the day it is crossed", () => expect(tiersCrossed(70 * M, 85 * M, L)).toEqual([0.8]));
  it("does not repeat 80% once it was already past it at the start of the day", () => expect(tiersCrossed(85 * M, 95 * M, L)).toEqual([]));
  it("fires 100% on the day it is reached", () => expect(tiersCrossed(95 * M, 100 * M, L)).toEqual([1]));
  it("reports both when one day jumps over both", () => expect(tiersCrossed(10 * M, 120 * M, L)).toEqual([0.8, 1]));
  it("stays quiet once over the limit", () => expect(tiersCrossed(110 * M, 150 * M, L)).toEqual([]));
});

describe("spendAlertEmail", () => {
  const spend = { costMicros: 85 * M, creditMicros: 20 * M, calls: 400 };
  it("80%: an early warning with the figures", () => {
    const m = spendAlertEmail({ tier: 0.8, spend, limitMicros: 100 * M, month: "November 2026" });
    expect(m.subject).toBe("Included AI spend is at 80% of your monthly limit ($85.00 of $100.00)");
    expect(m.text).toContain("Covered by plan allowances: $65.00");
    expect(m.text).toContain("Covered by bought credit:   $20.00");
    expect(m.text).toContain("estimates");
  });
  it("100%: says the limit is reached and what to check", () => {
    const m = spendAlertEmail({ tier: 1, spend: { ...spend, costMicros: 101 * M }, limitMicros: 100 * M, month: "November 2026" });
    expect(m.subject).toBe("Included AI spend has reached your monthly limit ($101.00)");
    expect(m.text).toContain("Anthropic console");
  });
});

describe("runDailyPlatformAiCheck", () => {
  const now = new Date("2026-11-20T08:00:00Z");
  const on = () => {
    vi.stubEnv("INCLUDED_AI_ANTHROPIC_KEY", "sk-ant-x");
    vi.stubEnv("INCLUDED_AI_ALERT_USD", "100");
    vi.stubEnv("INCLUDED_AI_ALERT_EMAIL", "owner@x.test");
  };
  it("does nothing when included AI is off (no platform key), and never queries", async () => {
    vi.stubEnv("INCLUDED_AI_ANTHROPIC_KEY", "");
    expect(await runDailyPlatformAiCheck(now)).toEqual({ skipped: "off" });
    expect(platformDb.aiUsage.aggregate).not.toHaveBeenCalled();
  });
  it("does nothing without an alert limit and email", async () => {
    vi.stubEnv("INCLUDED_AI_ANTHROPIC_KEY", "sk-ant-x");
    vi.stubEnv("INCLUDED_AI_ALERT_USD", "");
    expect(await runDailyPlatformAiCheck(now)).toEqual({ skipped: "no_alert_config" });
    expect(trySendMail).not.toHaveBeenCalled();
  });
  it("emails once when the month's spend crosses 80% since the start of today", async () => {
    on();
    platformDb.aiUsage.aggregate.mockResolvedValueOnce(agg(85, 10, 300)).mockResolvedValueOnce(agg(70, 5, 250));
    const r = await runDailyPlatformAiCheck(now);
    expect(r).toEqual({ spendMicros: 85 * M, limitMicros: 100 * M, alerted: 0.8 });
    expect(trySendMail).toHaveBeenCalledTimes(1);
    expect(trySendMail.mock.calls[0][0]).toMatchObject({ to: "owner@x.test", subject: expect.stringContaining("80%") });
    expect(trySendMail.mock.calls[0][0].text).toContain("November 2026");
  });
  it("measures from the first of the month (UTC) and, for the earlier figure, up to the start of today", async () => {
    on();
    platformDb.aiUsage.aggregate.mockResolvedValue(agg(1));
    await runDailyPlatformAiCheck(now);
    const wheres = platformDb.aiUsage.aggregate.mock.calls.map((c) => c[0].where);
    expect(wheres.every((w) => w.platformKey === true && w.createdAt.gte.toISOString() === "2026-11-01T00:00:00.000Z")).toBe(true);
    expect(wheres.map((w) => w.createdAt.lt.toISOString()).sort()).toEqual(["2026-11-20T00:00:00.000Z", "2026-11-20T08:00:00.001Z"]);
  });
  it("sends only the 100% email when one day jumps over both lines", async () => {
    on();
    platformDb.aiUsage.aggregate.mockResolvedValueOnce(agg(120, 0, 900)).mockResolvedValueOnce(agg(10, 0, 50));
    expect(((await runDailyPlatformAiCheck(now)) as { alerted: number }).alerted).toBe(1);
    expect(trySendMail).toHaveBeenCalledTimes(1);
    expect(trySendMail.mock.calls[0][0].subject).toContain("reached your monthly limit");
  });
  it("sends nothing when the earlier days were already past the line", async () => {
    on();
    platformDb.aiUsage.aggregate.mockResolvedValueOnce(agg(92)).mockResolvedValueOnce(agg(90));
    expect(((await runDailyPlatformAiCheck(now)) as { alerted: number | null }).alerted).toBeNull();
    expect(trySendMail).not.toHaveBeenCalled();
  });
  it("still finishes when the email fails to send (the daily job keeps going)", async () => {
    on();
    trySendMail.mockResolvedValue(false);
    platformDb.aiUsage.aggregate.mockResolvedValueOnce(agg(85)).mockResolvedValueOnce(agg(70));
    await expect(runDailyPlatformAiCheck(now)).resolves.toMatchObject({ alerted: 0.8 });
  });
});

describe("spend report", () => {
  it("lists each business biggest first, with credit left over all time", async () => {
    platformDb.aiUsage.aggregate.mockResolvedValue(agg(12.5, 2.5, 60));
    platformDb.aiUsage.groupBy
      .mockResolvedValueOnce([
        { tenantId: "a", _sum: { costMicros: 2 * M, creditMicros: 0 }, _count: 10 },
        { tenantId: "b", _sum: { costMicros: 10.5 * M, creditMicros: 2.5 * M }, _count: 50 },
      ])
      .mockResolvedValueOnce([{ tenantId: "b", _sum: { creditMicros: 4 * M } }]);
    platformDb.tenant.findMany.mockResolvedValue([{ id: "a", name: "Alpha Shop", plan: "starter" }, { id: "b", name: "Beta Ltd", plan: "pro" }]);
    platformDb.aiCredit.groupBy.mockResolvedValue([{ tenantId: "b", _sum: { amountMicros: 12.5 * M } }]);
    const r = await buildSpendReport(new Date("2026-11-20T08:00:00Z"));
    expect(r.month).toBe("2026-11");
    expect(r.rows.map((x) => x.name)).toEqual(["Beta Ltd", "Alpha Shop"]);
    expect(r.rows[0]).toMatchObject({ costMicros: 10.5 * M, fromCreditMicros: 2.5 * M, creditLeftMicros: 8.5 * M, calls: 50 });
    expect(r.rows[1].creditLeftMicros).toBe(0);
    const text = formatSpendReport(r);
    expect(text).toContain("Total $12.50 over 60 calls: $10.00 from plan allowances, $2.50 from bought credit");
    expect(text).toContain("Beta Ltd");
    expect(text).toContain("Anthropic console");
  });
  it("says so plainly when nothing has been used", async () => {
    platformDb.aiUsage.aggregate.mockResolvedValue({ _sum: { costMicros: null, creditMicros: null }, _count: 0 });
    platformDb.aiUsage.groupBy.mockResolvedValue([]);
    platformDb.tenant.findMany.mockResolvedValue([]);
    platformDb.aiCredit.groupBy.mockResolvedValue([]);
    const r = await buildSpendReport(new Date("2026-11-02T00:00:00Z"));
    expect(r.rows).toEqual([]);
    expect(formatSpendReport(r)).toContain("Total $0.00 over 0 calls");
  });
});
