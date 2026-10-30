import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({ db: { automationSetting: { findUnique: vi.fn(), upsert: vi.fn() } } }));
vi.mock("@/lib/db", () => ({ db }));

import { assistantSettingsSchema, DEFAULT_ASSISTANT, loadAssistantSettings, resolveAssistant, saveAssistantSettings } from "@/lib/ai/settings";

describe("assistantSettingsSchema", () => {
  it("accepts off with no ceiling, and on with one", () => {
    expect(assistantSettingsSchema.parse({ enabled: false, monthlyCeilingUsd: null })).toEqual({ enabled: false, monthlyCeilingUsd: null });
    expect(assistantSettingsSchema.parse({ enabled: true, monthlyCeilingUsd: 20 })).toEqual({ enabled: true, monthlyCeilingUsd: 20 });
  });

  it("will not switch Ivy on without a ceiling: there is no default amount", () => {
    const r = assistantSettingsSchema.safeParse({ enabled: true, monthlyCeilingUsd: null });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["monthlyCeilingUsd"]);
  });

  it("rejects zero, negative, huge and non-numeric ceilings", () => {
    for (const bad of [0, -5, 10_001, "20", NaN]) expect(assistantSettingsSchema.safeParse({ enabled: false, monthlyCeilingUsd: bad }).success, String(bad)).toBe(false);
  });

  it("rounds a ceiling to whole cents", () => {
    expect(assistantSettingsSchema.parse({ enabled: false, monthlyCeilingUsd: 12.3456 }).monthlyCeilingUsd).toBe(12.35);
  });
});

describe("resolveAssistant", () => {
  it("is off with no ceiling when nothing is stored", () => expect(resolveAssistant(undefined)).toEqual(DEFAULT_ASSISTANT));

  it("falls back to off, never to something that spends, when the stored value is no longer valid", () => {
    expect(resolveAssistant({ enabled: true })).toEqual(DEFAULT_ASSISTANT);
    expect(resolveAssistant({ enabled: true, monthlyCeilingUsd: null })).toEqual(DEFAULT_ASSISTANT);
    expect(resolveAssistant("garbage")).toEqual(DEFAULT_ASSISTANT);
  });
});

describe("load and save", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the assistant row of that business", async () => {
    db.automationSetting.findUnique.mockResolvedValue({ config: { enabled: true, monthlyCeilingUsd: 15 } });
    expect(await loadAssistantSettings("t1")).toEqual({ enabled: true, monthlyCeilingUsd: 15 });
    expect(db.automationSetting.findUnique).toHaveBeenCalledWith({ where: { tenantId_key: { tenantId: "t1", key: "assistant" } } });
  });

  it("saves under the assistant key for that business and returns what is stored", async () => {
    db.automationSetting.findUnique.mockResolvedValue({ config: { enabled: false, monthlyCeilingUsd: 8 } });
    const out = await saveAssistantSettings("t1", { enabled: false, monthlyCeilingUsd: 8 }, "u1");
    expect(db.automationSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_key: { tenantId: "t1", key: "assistant" } },
        create: { tenantId: "t1", key: "assistant", config: { enabled: false, monthlyCeilingUsd: 8 }, updatedById: "u1" },
      }),
    );
    expect(out).toEqual({ enabled: false, monthlyCeilingUsd: 8 });
  });

  it("keeps the proposed-actions choice when a save leaves it out (the limit and on/off buttons do)", async () => {
    db.automationSetting.findUnique.mockResolvedValue({ config: { enabled: true, monthlyCeilingUsd: 8, proposalsEnabled: true } });
    await saveAssistantSettings("t1", { enabled: true, monthlyCeilingUsd: 12 }, "u1");
    expect(db.automationSetting.upsert.mock.calls[0][0].update.config).toEqual({ enabled: true, monthlyCeilingUsd: 12, proposalsEnabled: true });
  });

  it("changes it only when asked to, in either direction", async () => {
    db.automationSetting.findUnique.mockResolvedValue({ config: { enabled: true, monthlyCeilingUsd: 8, proposalsEnabled: true } });
    await saveAssistantSettings("t1", { enabled: true, monthlyCeilingUsd: 8, proposalsEnabled: false }, "u1");
    expect(db.automationSetting.upsert.mock.calls[0][0].update.config.proposalsEnabled).toBe(false);
  });

  it("keeps the payment-proposals choice separately, and lets each switch change on its own", async () => {
    db.automationSetting.findUnique.mockResolvedValue({ config: { enabled: true, monthlyCeilingUsd: 8, proposalsEnabled: true, paymentProposalsEnabled: true } });
    await saveAssistantSettings("t1", { enabled: true, monthlyCeilingUsd: 8, proposalsEnabled: false }, "u1");
    expect(db.automationSetting.upsert.mock.calls[0][0].update.config).toEqual({ enabled: true, monthlyCeilingUsd: 8, proposalsEnabled: false, paymentProposalsEnabled: true });
    await saveAssistantSettings("t1", { enabled: true, monthlyCeilingUsd: 8, paymentProposalsEnabled: false }, "u1");
    expect(db.automationSetting.upsert.mock.calls[1][0].update.config).toEqual({ enabled: true, monthlyCeilingUsd: 8, proposalsEnabled: true, paymentProposalsEnabled: false });
  });

  it("keeps the daily-suggestions choice separately too", async () => {
    db.automationSetting.findUnique.mockResolvedValue({ config: { enabled: true, monthlyCeilingUsd: 8, proposalsEnabled: true, inboxEnabled: true } });
    await saveAssistantSettings("t1", { enabled: true, monthlyCeilingUsd: 9 }, "u1");
    expect(db.automationSetting.upsert.mock.calls[0][0].update.config).toEqual({ enabled: true, monthlyCeilingUsd: 9, proposalsEnabled: true, inboxEnabled: true });
    await saveAssistantSettings("t1", { enabled: true, monthlyCeilingUsd: 9, inboxEnabled: false }, "u1");
    expect(db.automationSetting.upsert.mock.calls[1][0].update.config.inboxEnabled).toBe(false);
    expect(resolveAssistant({ enabled: true, monthlyCeilingUsd: 5 }).inboxEnabled).toBeUndefined();
  });

  it("is off until an admin allows it", () => {
    expect(resolveAssistant({ enabled: true, monthlyCeilingUsd: 5 }).paymentProposalsEnabled).toBeUndefined();
    expect(resolveAssistant({ enabled: true, monthlyCeilingUsd: 5 }).proposalsEnabled).toBeUndefined();
    expect(resolveAssistant({ enabled: true, monthlyCeilingUsd: 5, proposalsEnabled: true }).proposalsEnabled).toBe(true);
    expect(assistantSettingsSchema.safeParse({ enabled: false, monthlyCeilingUsd: null, proposalsEnabled: "yes" }).success).toBe(false);
  });
});
