import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const { db, getIntegration } = vi.hoisted(() => ({
  db: {
    tenant: { findFirst: vi.fn() },
    aiUsage: { aggregate: vi.fn(), create: vi.fn() },
    aiCredit: { aggregate: vi.fn() },
  },
  getIntegration: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/integrations", () => ({ getIntegration }));

import { balanceOf, hasAiKey, includedBalance, planAllowanceUsd, platformCharge, resolveAiKey, splitCost } from "@/lib/ai/included";
import { recordUsage } from "@/lib/ai/usage";

const NOW = new Date("2026-11-16T12:00:00Z");
const ACTIVE_TENANT = { status: "ACTIVE", plan: "starter", billingStatus: "ACTIVE", trialEndsAt: null, currentPeriodEnd: null, deletionRequestedAt: null };

/** monthSpend / monthCredit: this month's platform rows; added: all credit bought; charged: all credit used so far. */
function ledger(o: { tenant?: unknown; monthSpend?: number; monthCredit?: number; added?: number; charged?: number }) {
  db.tenant.findFirst.mockResolvedValue(o.tenant === undefined ? ACTIVE_TENANT : o.tenant);
  db.aiUsage.aggregate.mockImplementation(({ where }: { where: { createdAt?: unknown } }) =>
    Promise.resolve({ _sum: where.createdAt ? { costMicros: o.monthSpend ?? 0, creditMicros: o.monthCredit ?? 0 } : { creditMicros: o.charged ?? 0 } }),
  );
  db.aiCredit.aggregate.mockResolvedValue({ _sum: { amountMicros: o.added ?? 0 } });
}

beforeEach(() => {
  vi.clearAllMocks();
  getIntegration.mockResolvedValue(null);
  vi.stubEnv("INCLUDED_AI_ANTHROPIC_KEY", "sk-ant-platform-test");
  vi.stubEnv("INCLUDED_AI_ALLOWANCE_STARTER", "3");
  vi.stubEnv("INCLUDED_AI_ALLOWANCE_PRO", "15");
  vi.stubEnv("INCLUDED_AI_ALLOWANCE_TRIAL", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("planAllowanceUsd", () => {
  it("reads the dollars each plan includes from the server settings", () => {
    expect(planAllowanceUsd("starter")).toBe(3);
    expect(planAllowanceUsd("pro")).toBe(15);
  });
  it("uses the owner's chosen amounts ($2 Starter, $10 Pro, $0 trial) when nothing is set", () => {
    vi.stubEnv("INCLUDED_AI_ALLOWANCE_STARTER", "");
    vi.stubEnv("INCLUDED_AI_ALLOWANCE_PRO", "");
    vi.stubEnv("INCLUDED_AI_ALLOWANCE_TRIAL", "");
    expect(planAllowanceUsd("starter")).toBe(2);
    expect(planAllowanceUsd("pro")).toBe(10);
    expect(planAllowanceUsd("trial")).toBe(0);
  });
  it("falls back to those amounts for an invalid or negative value, and 0 switches a plan off", () => {
    vi.stubEnv("INCLUDED_AI_ALLOWANCE_STARTER", "abc");
    expect(planAllowanceUsd("starter")).toBe(2);
    vi.stubEnv("INCLUDED_AI_ALLOWANCE_STARTER", "-5");
    expect(planAllowanceUsd("starter")).toBe(2);
    vi.stubEnv("INCLUDED_AI_ALLOWANCE_STARTER", "0");
    expect(planAllowanceUsd("starter")).toBe(0);
  });
  it("is zero for the internal plan, and an unknown plan counts as the trial", () => {
    expect(planAllowanceUsd("internal")).toBe(0);
    expect(planAllowanceUsd("mystery")).toBe(0);
  });
  it("gives the free trial nothing even if the server key is set", () => expect(planAllowanceUsd("trial")).toBe(0));
});

describe("splitCost", () => {
  it("uses the allowance first", () => expect(splitCost(500, 1000, 1000)).toEqual({ fromAllowance: 500, fromCredit: 0 }));
  it("charges the rest to credit", () => expect(splitCost(500, 200, 1000)).toEqual({ fromAllowance: 200, fromCredit: 300 }));
  it("never charges more credit than there is", () => expect(splitCost(500, 100, 50)).toEqual({ fromAllowance: 100, fromCredit: 50 }));
  it("ignores negative amounts", () => expect(splitCost(500, -10, -10)).toEqual({ fromAllowance: 0, fromCredit: 0 }));
});

describe("balanceOf", () => {
  const base = { allowanceMicros: 3_000_000, allowanceUsedMicros: 0, creditAddedMicros: 0, creditChargedMicros: 0, writable: true, keyConfigured: true };
  it("is the unused allowance plus the credit left", () => {
    expect(balanceOf({ ...base, allowanceUsedMicros: 1_000_000, creditAddedMicros: 5_000_000, creditChargedMicros: 2_000_000 }).leftMicros).toBe(2_000_000 + 3_000_000);
  });
  it("is eligible with an allowance or with credit, not with neither", () => {
    expect(balanceOf(base).eligible).toBe(true);
    expect(balanceOf({ ...base, allowanceMicros: 0 }).eligible).toBe(false);
    expect(balanceOf({ ...base, allowanceMicros: 0, creditAddedMicros: 1 }).eligible).toBe(true);
  });
  it("is nothing when the platform key is missing or the business is read-only", () => {
    expect(balanceOf({ ...base, keyConfigured: false })).toMatchObject({ eligible: false, leftMicros: 0 });
    expect(balanceOf({ ...base, writable: false })).toMatchObject({ eligible: false, leftMicros: 0 });
  });
  it("never goes below zero", () => expect(balanceOf({ ...base, allowanceUsedMicros: 9_000_000, creditAddedMicros: 1, creditChargedMicros: 99 }).leftMicros).toBe(0));
});

describe("includedBalance", () => {
  it("does no lookups at all when there is no platform key", async () => {
    vi.stubEnv("INCLUDED_AI_ANTHROPIC_KEY", "");
    expect(await includedBalance("t1", NOW)).toMatchObject({ eligible: false, leftMicros: 0 });
    expect(db.tenant.findFirst).not.toHaveBeenCalled();
  });
  it("counts only this month's platform spend that came out of the allowance", async () => {
    ledger({ monthSpend: 2_000_000, monthCredit: 500_000 });
    const b = await includedBalance("t1", NOW);
    expect(b.allowanceUsedMicros).toBe(1_500_000);
    expect(b.leftMicros).toBe(1_500_000);
  });
  it("sums credit over all time, minus what was already charged", async () => {
    ledger({ added: 10_000_000, charged: 4_000_000, monthSpend: 3_000_000, monthCredit: 0 });
    expect((await includedBalance("t1", NOW)).creditMicros).toBe(6_000_000);
  });
  it("is nothing for a business that is read-only (trial over, unpaid)", async () => {
    ledger({ tenant: { ...ACTIVE_TENANT, billingStatus: "CANCELED", currentPeriodEnd: new Date("2026-01-01") } });
    expect(await includedBalance("t1", NOW)).toMatchObject({ eligible: false, leftMicros: 0 });
  });
});

describe("resolveAiKey", () => {
  it("prefers the business's own key, and says so", async () => {
    getIntegration.mockResolvedValue({ settings: { apiKey: "sk-own" }, source: "settings" });
    expect(await resolveAiKey("t1", NOW)).toEqual({ kind: "own", apiKey: "sk-own" });
    expect(db.tenant.findFirst).not.toHaveBeenCalled();
  });
  it("marks the original business's server key as env, never as platform", async () => {
    getIntegration.mockResolvedValue({ settings: { apiKey: "sk-env" }, source: "env" });
    expect(await resolveAiKey("t1", NOW)).toEqual({ kind: "env", apiKey: "sk-env" });
  });
  it("uses the platform key when the plan includes AI that is not used up", async () => {
    ledger({ monthSpend: 1_000_000 });
    expect(await resolveAiKey("t1", NOW)).toEqual({ kind: "platform", apiKey: "sk-ant-platform-test" });
  });
  it("says used up once allowance and credit are gone", async () => {
    ledger({ monthSpend: 3_000_000 });
    expect(await resolveAiKey("t1", NOW)).toEqual({ kind: "none", reason: "included_exhausted" });
  });
  it("credit keeps AI going after the allowance is used", async () => {
    ledger({ monthSpend: 3_000_000, added: 5_000_000 });
    expect((await resolveAiKey("t1", NOW)).kind).toBe("platform");
  });
  it("is no key for a plan with no allowance and no credit", async () => {
    ledger({ tenant: { ...ACTIVE_TENANT, plan: "trial" } });
    expect(await resolveAiKey("t1", NOW)).toEqual({ kind: "none", reason: "no_key" });
  });
  it("is no key when no platform key is configured", async () => {
    vi.stubEnv("INCLUDED_AI_ANTHROPIC_KEY", "");
    expect(await resolveAiKey("t1", NOW)).toEqual({ kind: "none", reason: "no_key" });
    expect(await hasAiKey("t1")).toBe(false);
  });
});

describe("recording a call", () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

  it("is not a platform call when the business has its own key", async () => {
    getIntegration.mockResolvedValue({ settings: { apiKey: "sk-own" }, source: "settings" });
    expect(await platformCharge("t1", 400_000, NOW)).toEqual({ platformKey: false, creditMicros: 0 });
  });
  it("is a free platform call while the allowance covers it", async () => {
    ledger({ monthSpend: 0 });
    expect(await platformCharge("t1", 400_000, NOW)).toEqual({ platformKey: true, creditMicros: 0 });
  });
  it("charges the overflow to credit", async () => {
    ledger({ monthSpend: 2_800_000, added: 1_000_000 });
    expect(await platformCharge("t1", 500_000, NOW)).toEqual({ platformKey: true, creditMicros: 300_000 });
  });
  it("stores platformKey and the credit part on the usage row", async () => {
    ledger({ monthSpend: 2_900_000, added: 1_000_000 });
    const cost = await recordUsage({ tenantId: "t1", model: "claude-sonnet-5-5", usage });
    expect(cost).toBe(2_000_000);
    expect(db.aiUsage.create.mock.calls[0][0].data).toMatchObject({ platformKey: true, creditMicros: 1_000_000, costMicros: 2_000_000 });
  });
  it("leaves ordinary businesses exactly as before, with no extra lookups, when no platform key is set", async () => {
    vi.stubEnv("INCLUDED_AI_ANTHROPIC_KEY", "");
    await recordUsage({ tenantId: "t1", model: "claude-sonnet-5-5", usage });
    expect(db.aiUsage.create.mock.calls[0][0].data).toMatchObject({ platformKey: false, creditMicros: 0 });
    expect(getIntegration).not.toHaveBeenCalled();
    expect(db.aiCredit.aggregate).not.toHaveBeenCalled();
  });
});

describe("the migration", () => {
  const sql = readFileSync("prisma/migrations/20261129000000_included_ai/migration.sql", "utf8");
  it("makes a payment that is reported twice add its credit once", () => expect(sql).toContain('CREATE UNIQUE INDEX "AiCredit_tenantId_reference_key" ON "AiCredit"("tenantId", "reference")'));
  it("only accepts positive credit", () => expect(sql).toContain('CHECK ("amountMicros" > 0)'));
  it("leaves existing usage rows as ordinary (non-platform) calls", () => {
    expect(sql).toContain('"platformKey" BOOLEAN NOT NULL DEFAULT false');
    expect(sql).toContain('"creditMicros" INTEGER NOT NULL DEFAULT 0');
  });
  it("gives the app role read access only: credit is added by the platform, never by a business", () => {
    expect(sql).toContain('GRANT SELECT ON "AiCredit" TO crm_app');
    expect(sql).not.toMatch(/GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*"AiCredit"/);
  });
});
