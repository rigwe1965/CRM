import { beforeEach, describe, expect, it, vi } from "vitest";

const { settings, spent, byPurpose, integration, rate } = vi.hoisted(() => ({
  settings: vi.fn(),
  spent: vi.fn(),
  byPurpose: vi.fn(),
  integration: vi.fn(),
  rate: vi.fn(),
}));
vi.mock("@/lib/ai/settings", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/settings")>()), loadAssistantSettings: settings }));
vi.mock("@/lib/ai/usage", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/usage")>()), monthToDateMicros: spent, monthToDateByPurpose: byPurpose }));
vi.mock("@/lib/integrations", () => ({ getIntegration: integration }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), enforceRateLimit: rate }));

import { assertCanAsk, assertUnderCeiling, assistantStatus } from "@/lib/ai/status";
import { AI_RETENTION_DAYS } from "@/lib/ai/retention";

const user = { id: "u1", tenantId: "t1" };
const NOW = new Date("2026-10-30T10:00:00Z");
const ready = () => {
  settings.mockResolvedValue({ enabled: true, monthlyCeilingUsd: 10 });
  integration.mockResolvedValue({ settings: { apiKey: "sk-ant-very-secret-value-0123456789" }, source: "settings" });
  spent.mockResolvedValue(1_000_000);
  byPurpose.mockResolvedValue({ CHAT: 800_000, INBOX: 200_000 });
};

beforeEach(() => {
  vi.clearAllMocks();
  rate.mockResolvedValue(undefined);
  ready();
});

describe("assistantStatus", () => {
  it("summarises state for the admin screen without ever containing the key", async () => {
    const s = await assistantStatus("t1", NOW);
    expect(s).toMatchObject({ keyConfigured: true, keySource: "settings", enabled: true, monthlyCeilingUsd: 10, level: "ok", spentUsd: 1, percent: 10, resetsOn: "2026-11-01", retentionDays: AI_RETENTION_DAYS });
    expect(JSON.stringify(s)).not.toContain("sk-ant");
  });

  it("shows what this month's spend went on, and which optional parts are allowed", async () => {
    settings.mockResolvedValue({ enabled: true, monthlyCeilingUsd: 10, proposalsEnabled: true, paymentProposalsEnabled: true, inboxEnabled: true });
    const s = await assistantStatus("t1", NOW);
    expect(s).toMatchObject({ proposalsEnabled: true, paymentProposalsEnabled: true, inboxEnabled: true, spentByPurposeUsd: { chat: 0.8, inbox: 0.2, triage: 0 } });
    settings.mockResolvedValue({ enabled: true, monthlyCeilingUsd: 10 });
    expect(await assistantStatus("t1", NOW)).toMatchObject({ proposalsEnabled: false, paymentProposalsEnabled: false, inboxEnabled: false, triageEnabled: false, triageDailyCap: 100 });
    settings.mockResolvedValue({ enabled: true, monthlyCeilingUsd: 10, triageEnabled: true, triageDailyCap: 25 });
    expect(await assistantStatus("t1", NOW)).toMatchObject({ triageEnabled: true, triageDailyCap: 25 });
  });

  it("reports an environment-supplied key as such", async () => {
    integration.mockResolvedValue({ settings: { apiKey: "sk-ant-x" }, source: "env" });
    expect((await assistantStatus("t1", NOW)).keySource).toBe("env");
  });

  it("reads everything for the named business", async () => {
    await assistantStatus("t9", NOW);
    expect(settings).toHaveBeenCalledWith("t9");
    expect(integration).toHaveBeenCalledWith("t9", "ANTHROPIC");
    expect(spent).toHaveBeenCalledWith("t9", NOW);
  });
});

describe("assertCanAsk", () => {
  it("lets a question through when Ivy is on, has a key, is under its ceiling, and the user is not rate limited", async () => {
    await expect(assertCanAsk(user, NOW)).resolves.toMatchObject({ level: "ok" });
    expect(rate).toHaveBeenCalledWith("ai:ask:u1", expect.objectContaining({ max: 20 }));
  });

  it("refuses while Ivy is switched off", async () => {
    settings.mockResolvedValue({ enabled: false, monthlyCeilingUsd: 10 });
    await expect(assertCanAsk(user, NOW)).rejects.toMatchObject({ status: 403, code: "AI_DISABLED" });
  });

  it("refuses with no key", async () => {
    integration.mockResolvedValue(null);
    await expect(assertCanAsk(user, NOW)).rejects.toMatchObject({ status: 409, code: "AI_NOT_CONFIGURED" });
  });

  it("refuses with no ceiling (there is no default)", async () => {
    settings.mockResolvedValue({ enabled: true, monthlyCeilingUsd: null });
    await expect(assertCanAsk(user, NOW)).rejects.toMatchObject({ status: 409, code: "AI_CEILING_UNSET" });
  });

  it("refuses once the ceiling is reached, and says when it resumes", async () => {
    spent.mockResolvedValue(10_000_000);
    const e = await assertCanAsk(user, NOW).catch((x) => x);
    expect(e).toMatchObject({ status: 429, code: "AI_CEILING_REACHED" });
    expect(e.message).toContain("2026-11-01");
  });

  it("still allows a question in the warning zone", async () => {
    spent.mockResolvedValue(9_000_000);
    await expect(assertCanAsk(user, NOW)).resolves.toMatchObject({ level: "warn" });
  });

  it("does not spend a rate-limit slot on a question it refuses anyway", async () => {
    settings.mockResolvedValue({ enabled: false, monthlyCeilingUsd: 10 });
    await assertCanAsk(user, NOW).catch(() => undefined);
    expect(rate).not.toHaveBeenCalled();
  });

  it("passes on a rate-limit refusal", async () => {
    rate.mockRejectedValue(Object.assign(new Error("Too many requests"), { status: 429, code: "RATE_LIMITED" }));
    await expect(assertCanAsk(user, NOW)).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
  });
});

describe("assertUnderCeiling", () => {
  it("passes under the ceiling and stops at it", async () => {
    await expect(assertUnderCeiling("t1", NOW)).resolves.toMatchObject({ level: "ok" });
    spent.mockResolvedValue(10_000_001);
    await expect(assertUnderCeiling("t1", NOW)).rejects.toMatchObject({ status: 429, code: "AI_CEILING_REACHED" });
  });

  it("stops if the ceiling was removed mid-answer", async () => {
    settings.mockResolvedValue({ enabled: true, monthlyCeilingUsd: null });
    await expect(assertUnderCeiling("t1", NOW)).rejects.toMatchObject({ code: "AI_CEILING_REACHED" });
  });
});
