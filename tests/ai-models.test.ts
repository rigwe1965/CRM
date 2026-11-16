import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({ db: { automationSetting: { findUnique: vi.fn(), upsert: vi.fn() } } }));
vi.mock("@/lib/db", () => ({ db }));

import { DEFAULT_MODEL, FALLBACK_BETA, MODEL_OPTIONS, isSelectableModel, modelFields, resolveModel } from "@/lib/ai/models";
import { PRICES, costMicros } from "@/lib/ai/pricing";
import { assistantSettingsSchema, loadAssistantSettings, resolveAssistant, saveAssistantSettings } from "@/lib/ai/settings";
import { triageRequest } from "@/lib/ai/triage/run";

beforeEach(() => vi.clearAllMocks());

describe("the model list", () => {
  it("keeps the model AI has always used as the default", () => expect(DEFAULT_MODEL).toBe("claude-sonnet-5-5"));
  it("has a price for every model a business can pick, so the ceiling can count it", () => {
    for (const m of MODEL_OPTIONS) expect(PRICES[m.id], m.id).toBeDefined();
  });
  it("accepts only listed models", () => {
    expect(isSelectableModel("claude-opus-5-5")).toBe(true);
    for (const bad of ["claude-mystery", "", undefined, null, 5, "claude-sonnet-5-5; drop"]) expect(isSelectableModel(bad), String(bad)).toBe(false);
  });
  it("treats anything else as the default, never as something it cannot price", () => {
    expect(resolveModel("claude-mystery")).toBe(DEFAULT_MODEL);
    expect(resolveModel(undefined)).toBe(DEFAULT_MODEL);
    expect(resolveModel("claude-haiku-5-5")).toBe("claude-haiku-5-5");
  });
  it("prices Haiku below Sonnet below Opus", () => {
    const u = { inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(costMicros("claude-haiku-5-5", u)).toBeLessThan(costMicros("claude-sonnet-5-5", u));
    expect(costMicros("claude-sonnet-5-5", u)).toBeLessThan(costMicros("claude-opus-5-5", u));
  });
});

describe("modelFields", () => {
  it("is exactly what the CRM always sent when no model was chosen", () => {
    expect(modelFields()).toEqual({ model: "claude-sonnet-5-5", output_config: { effort: "low" }, betas: [FALLBACK_BETA], fallbacks: "default" });
  });
  it("asks for the server-side fallback only for models that accept it", () => {
    expect(modelFields("claude-haiku-5-5")).toMatchObject({ model: "claude-haiku-5-5", betas: undefined, fallbacks: undefined });
    expect(modelFields("claude-opus-5-5")).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default" });
  });
  it("falls back to the default for an unknown stored model", () => expect(modelFields("gone").model).toBe(DEFAULT_MODEL));
  it("reaches the document and triage requests", () => {
    expect(triageRequest({ customer: {}, thread: [] }).model).toBe(DEFAULT_MODEL);
    expect(triageRequest({ customer: {}, thread: [] }, [], "claude-opus-5-5").model).toBe("claude-opus-5-5");
  });
});

describe("the stored model setting", () => {
  it("rejects a model that is not on the list", () => {
    expect(assistantSettingsSchema.safeParse({ enabled: false, monthlyCeilingUsd: null, model: "claude-mystery" }).success).toBe(false);
    expect(assistantSettingsSchema.safeParse({ enabled: false, monthlyCeilingUsd: null, model: "claude-opus-5-5" }).success).toBe(true);
  });
  it("loads as no choice when nothing is stored, so the default applies", () => expect(resolveAssistant(undefined).model).toBeUndefined());
  it("a save that leaves the model out keeps the stored one", async () => {
    db.automationSetting.findUnique.mockResolvedValue({ config: { enabled: true, monthlyCeilingUsd: 20, model: "claude-opus-5-5" } });
    await saveAssistantSettings("t1", { enabled: false, monthlyCeilingUsd: 20 }, "u1");
    expect(db.automationSetting.upsert.mock.calls[0][0].update.config.model).toBe("claude-opus-5-5");
  });
  it("a save that names a model changes it", async () => {
    db.automationSetting.findUnique.mockResolvedValue({ config: { enabled: true, monthlyCeilingUsd: 20, model: "claude-opus-5-5" } });
    await saveAssistantSettings("t1", { enabled: true, monthlyCeilingUsd: 20, model: "claude-haiku-5-5" }, "u1");
    expect(db.automationSetting.upsert.mock.calls[0][0].update.config.model).toBe("claude-haiku-5-5");
  });
  it("a stored model that is no longer allowed means the default model, and AI stays on", async () => {
    db.automationSetting.findUnique.mockResolvedValue({ config: { enabled: true, monthlyCeilingUsd: 20, model: "retired-model" } });
    const s = await loadAssistantSettings("t1");
    expect(s.enabled).toBe(true);
    expect(resolveModel(s.model)).toBe(DEFAULT_MODEL);
  });
});
