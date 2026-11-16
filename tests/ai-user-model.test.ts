import { beforeEach, describe, expect, it, vi } from "vitest";

const { rows, db } = vi.hoisted(() => {
  const rows = new Map<string, unknown>();
  const k = (w: { tenantId_key: { tenantId: string; key: string } }) => `${w.tenantId_key.tenantId}|${w.tenantId_key.key}`;
  const db = {
    automationSetting: {
      findUnique: vi.fn(async ({ where }: { where: { tenantId_key: { tenantId: string; key: string } } }) => (rows.has(k(where)) ? { config: rows.get(k(where)) } : null)),
      upsert: vi.fn(async ({ where, create, update }: { where: { tenantId_key: { tenantId: string; key: string } }; create: { config: unknown }; update: { config: unknown } }) => {
        rows.set(k(where), rows.has(k(where)) ? update.config : create.config);
      }),
      deleteMany: vi.fn(async ({ where }: { where: { tenantId: string; key: string } }) => {
        rows.delete(`${where.tenantId}|${where.key}`);
      }),
    },
  };
  return { rows, db };
});
vi.mock("@/lib/db", () => ({ db }));

import { SELECTABLE_MODEL_IDS } from "@/lib/ai/models";
import { assistantSettingsSchema, effectiveModel, loadUserModel, resolveAssistant, saveAssistantSettings, saveUserModel } from "@/lib/ai/settings";

const [A, B] = SELECTABLE_MODEL_IDS; // two real model ids from the allowlist
const account = (over: Record<string, unknown> = {}) => rows.set("t1|assistant", { enabled: true, monthlyCeilingUsd: 20, model: A, ...over });

beforeEach(() => {
  rows.clear();
  vi.clearAllMocks();
});

describe("the business's switch", () => {
  it("is optional in the schema and off unless an admin turns it on", () => {
    expect(assistantSettingsSchema.safeParse({ enabled: false, monthlyCeilingUsd: null }).success).toBe(true);
    expect(resolveAssistant({ enabled: true, monthlyCeilingUsd: 5 }).userModelChoice).toBeUndefined();
    expect(resolveAssistant({ enabled: true, monthlyCeilingUsd: 5, userModelChoice: true }).userModelChoice).toBe(true);
  });
  it("is kept when another setting is saved without it, and can be turned off", async () => {
    account({ userModelChoice: true });
    await saveAssistantSettings("t1", { enabled: true, monthlyCeilingUsd: 20, inboxEnabled: true }, "admin");
    expect((rows.get("t1|assistant") as { userModelChoice?: boolean }).userModelChoice).toBe(true);
    await saveAssistantSettings("t1", { enabled: true, monthlyCeilingUsd: 20, userModelChoice: false }, "admin");
    expect((rows.get("t1|assistant") as { userModelChoice?: boolean }).userModelChoice).toBe(false);
  });
});

describe("a person's own choice", () => {
  it("is stored under a key of its own, for that business and person only", async () => {
    await saveUserModel("t1", "u1", B);
    expect(rows.get("t1|assistant-user:u1")).toEqual({ model: B });
    expect(db.automationSetting.upsert.mock.calls[0][0].create).toMatchObject({ tenantId: "t1", key: "assistant-user:u1", updatedById: "u1" });
    expect(await loadUserModel("t1", "u1")).toBe(B);
    expect(await loadUserModel("t1", "u2")).toBeUndefined();
    expect(await loadUserModel("t2", "u1")).toBeUndefined();
  });
  it("changes by saving again, and clears with null", async () => {
    await saveUserModel("t1", "u1", A);
    await saveUserModel("t1", "u1", B);
    expect(await loadUserModel("t1", "u1")).toBe(B);
    await saveUserModel("t1", "u1", null);
    expect(await loadUserModel("t1", "u1")).toBeUndefined();
    expect(db.automationSetting.deleteMany).toHaveBeenCalledWith({ where: { tenantId: "t1", key: "assistant-user:u1" } });
  });
  it("is ignored when the stored model has since been retired", async () => {
    rows.set("t1|assistant-user:u1", { model: "claude-retired-9" });
    expect(await loadUserModel("t1", "u1")).toBeUndefined();
  });
  it("is ignored when the stored value is not shaped like a choice", async () => {
    rows.set("t1|assistant-user:u1", "garbage");
    expect(await loadUserModel("t1", "u1")).toBeUndefined();
  });
});

describe("effectiveModel: which model answers", () => {
  it("is the person's own when the business allows it and they chose one", async () => {
    account({ userModelChoice: true });
    await saveUserModel("t1", "u1", B);
    expect(await effectiveModel("t1", "u1")).toBe(B);
  });
  it("is the business's model for someone who has not chosen", async () => {
    account({ userModelChoice: true });
    expect(await effectiveModel("t1", "u2")).toBe(A);
  });
  it("ignores a stored choice entirely while the business does not allow it, without even reading it", async () => {
    account({ userModelChoice: false });
    await saveUserModel("t1", "u1", B);
    db.automationSetting.findUnique.mockClear();
    expect(await effectiveModel("t1", "u1")).toBe(A);
    expect(db.automationSetting.findUnique).toHaveBeenCalledTimes(1); // only the business's settings
  });
  it("is the business's model when no person is given (background jobs)", async () => {
    account({ userModelChoice: true });
    await saveUserModel("t1", "u1", B);
    expect(await effectiveModel("t1")).toBe(A);
    expect(await effectiveModel("t1", null)).toBe(A);
  });
  it("is undefined (the default model) when neither the person nor the business has chosen", async () => {
    account({ model: undefined, userModelChoice: true });
    expect(await effectiveModel("t1", "u1")).toBeUndefined();
  });
  it("never leaks one person's choice to another", async () => {
    account({ userModelChoice: true });
    await saveUserModel("t1", "u1", B);
    expect(await effectiveModel("t1", "u2")).toBe(A);
  });
});
