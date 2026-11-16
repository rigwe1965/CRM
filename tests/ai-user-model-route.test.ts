import { beforeEach, describe, expect, it, vi } from "vitest";

const { roles, state, load, loadUser, saveUser, key, verify, limit } = vi.hoisted(() => ({
  roles: new Map<string, unknown[]>(),
  state: vi.fn(),
  load: vi.fn(),
  loadUser: vi.fn(),
  saveUser: vi.fn(),
  key: vi.fn(),
  verify: vi.fn(),
  limit: vi.fn(),
}));

// Skip auth; remember which roles each handler asked for. The signed-in person is a plain SALES user.
vi.mock("@/lib/route", () => ({
  authed:
    (handler: (ctx: unknown) => Promise<Response>, ...r: unknown[]) => {
      roles.set(String(handler), r);
      return async (req: Request) => handler({ req, user: { id: "u1", role: "SALES", tenantId: "t1" } });
    },
}));
vi.mock("@/lib/ai/status", () => ({ userModelState: state }));
vi.mock("@/lib/ai/settings", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/settings")>()), loadAssistantSettings: load, loadUserModel: loadUser, saveUserModel: saveUser }));
vi.mock("@/lib/ai/included", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/included")>()), resolveAiKey: key }));
vi.mock("@/lib/ai/client", () => ({ verifyApiKey: verify }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), enforceRateLimit: limit }));

import * as route from "@/app/api/assistant/model/route";
import { SELECTABLE_MODEL_IDS } from "@/lib/ai/models";

const [A, B] = SELECTABLE_MODEL_IDS;
const SECRET = "sk-ant-api03-this-is-a-secret-key-0123456789";
const view = { allowed: true, own: null, businessModel: A, model: A, options: [{ id: A, label: "A", blurb: "" }] };
const get = () => (route.GET as unknown as (r: Request) => Promise<Response>)(new Request("http://x.test/api/assistant/model"));
const put = (body: unknown) => (route.PUT as unknown as (r: Request) => Promise<Response>)(new Request("http://x.test/api/assistant/model", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  vi.resetAllMocks();
  state.mockResolvedValue(view);
  load.mockResolvedValue({ enabled: true, monthlyCeilingUsd: 20, model: A, userModelChoice: true });
  loadUser.mockResolvedValue(undefined);
  key.mockResolvedValue({ kind: "own", apiKey: SECRET });
  verify.mockResolvedValue(undefined);
});

describe("/api/assistant/model", () => {
  it("is open to every signed-in role, not just admins", () => {
    expect(roles.size).toBe(2);
    for (const r of roles.values()) expect(r).toEqual([]);
  });
  it("GET returns this person's state, for their own business, and never a key", async () => {
    const res = await get();
    expect(state).toHaveBeenCalledWith("t1", "u1");
    const text = await res.text();
    expect(JSON.parse(text).data).toMatchObject({ allowed: true, businessModel: A });
    expect(text).not.toContain("sk-ant");
  });
  it("PUT refuses while the business has not allowed it, and saves nothing", async () => {
    load.mockResolvedValue({ enabled: true, monthlyCeilingUsd: 20, model: A });
    await expect(put({ model: B })).rejects.toMatchObject({ code: "AI_USER_MODEL_OFF" });
    expect(saveUser).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });
  it("PUT checks the model against the business's key, then saves it for this person only", async () => {
    await put({ model: B });
    expect(verify).toHaveBeenCalledWith(SECRET, B);
    expect(saveUser).toHaveBeenCalledWith("t1", "u1", B);
    expect(limit).toHaveBeenCalledTimes(1);
  });
  it("PUT saves nothing when the key is refused for that model", async () => {
    verify.mockRejectedValue(new Error("This key cannot use that model"));
    await expect(put({ model: B })).rejects.toThrow("cannot use");
    expect(saveUser).not.toHaveBeenCalled();
  });
  it("PUT with null goes back to the business's model, with no key check", async () => {
    await put({ model: null });
    expect(saveUser).toHaveBeenCalledWith("t1", "u1", null);
    expect(verify).not.toHaveBeenCalled();
  });
  it("PUT of the model they already have skips the key check", async () => {
    loadUser.mockResolvedValue(B);
    await put({ model: B });
    expect(verify).not.toHaveBeenCalled();
    expect(saveUser).toHaveBeenCalledWith("t1", "u1", B);
  });
  it("PUT without a usable key says so plainly and saves nothing", async () => {
    key.mockResolvedValue({ kind: "none", reason: "no_key" });
    await expect(put({ model: B })).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
    expect(saveUser).not.toHaveBeenCalled();
  });
  it("PUT refuses a model that is not on the list, and anything that is not a model", async () => {
    for (const bad of [{ model: "claude-fake-1" }, { model: 5 }, {}, { model: "" }]) await expect(put(bad)).rejects.toBeDefined();
    expect(saveUser).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });
});
