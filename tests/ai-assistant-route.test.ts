import { beforeEach, describe, expect, it, vi } from "vitest";

const { roles, status, save, integration, verify, saveIntegration } = vi.hoisted(() => ({
  roles: new Map<string, unknown[]>(),
  status: vi.fn(),
  save: vi.fn(),
  integration: vi.fn(),
  verify: vi.fn(),
  saveIntegration: vi.fn(),
}));

// Skip auth and rate limiting; remember which roles each handler asked for.
vi.mock("@/lib/route", () => ({
  authed:
    (handler: (ctx: unknown) => Promise<Response>, ...r: unknown[]) => {
      const wrapped = async (req: Request, context?: { params: Promise<unknown> }) =>
        handler({ req, user: { id: "u1", role: "ADMIN", tenantId: "t1" }, params: await context?.params });
      roles.set(String(handler), r);
      return wrapped;
    },
}));
vi.mock("@/lib/ai/status", () => ({ assistantStatus: status }));
vi.mock("@/lib/ai/settings", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/settings")>()), saveAssistantSettings: save }));
vi.mock("@/lib/ai/client", () => ({ verifyApiKey: verify }));
vi.mock("@/lib/integrations", async (orig) => ({ ...(await orig<typeof import("@/lib/integrations")>()), getIntegration: integration, saveIntegration }));
vi.mock("@/lib/integrations-view", () => ({ integrationsView: async () => ({ stripe: { configured: false } }) }));

import * as assistant from "@/app/api/admin/assistant/route";
import * as integrationKind from "@/app/api/admin/integrations/[kind]/route";

const KEY = "sk-ant-api03-this-is-a-secret-key-0123456789";
const view = { keyConfigured: true, keySource: "settings", enabled: false, monthlyCeilingUsd: null, level: "unset", spentUsd: 0, ceilingUsd: null, percent: null, resetsOn: "2026-11-01", retentionDays: 90, model: "claude-sonnet-5-5" };
const json = (method: string, body: unknown) => new Request("http://x.test/api/admin/assistant", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const put = (body: unknown) => (assistant.PUT as unknown as (r: Request) => Promise<Response>)(json("PUT", body));
const putKey = (body: unknown) =>
  (integrationKind.PUT as unknown as (r: Request, c: { params: Promise<{ kind: string }> }) => Promise<Response>)(json("PUT", body), { params: Promise.resolve({ kind: "anthropic" }) });

beforeEach(() => {
  vi.resetAllMocks();
  status.mockResolvedValue(view);
  integration.mockResolvedValue({ settings: { apiKey: KEY }, source: "settings" });
});

describe("/api/admin/assistant", () => {
  it("is admin-only, for reading and for writing", () => {
    // Every handler registered by these routes (assistant GET and PUT, integration PUT and DELETE) asked for ADMIN.
    expect(roles.size).toBeGreaterThanOrEqual(4);
    for (const r of roles.values()) expect(r).toEqual(["ADMIN"]);
  });

  it("GET returns the status for the caller's business, and never a key", async () => {
    const res = await (assistant.GET as unknown as (r: Request) => Promise<Response>)(new Request("http://x.test/api/admin/assistant"));
    expect(status).toHaveBeenCalledWith("t1");
    const text = await res.text();
    expect(JSON.parse(text).data).toMatchObject({ keyConfigured: true, level: "unset" });
    expect(text).not.toContain("sk-ant");
  });

  it("PUT saves the settings for the caller's business", async () => {
    const res = await put({ enabled: true, monthlyCeilingUsd: 25 });
    expect(res.status).toBe(200);
    expect(save).toHaveBeenCalledWith("t1", { enabled: true, monthlyCeilingUsd: 25 }, "u1");
  });

  it("PUT refuses to switch Ivy on without a ceiling", async () => {
    await expect(put({ enabled: true, monthlyCeilingUsd: null })).rejects.toMatchObject({ status: 422 });
    expect(save).not.toHaveBeenCalled();
  });

  it("PUT refuses to switch Ivy on without a saved key", async () => {
    integration.mockResolvedValue(null);
    await expect(put({ enabled: true, monthlyCeilingUsd: 10 })).rejects.toMatchObject({ status: 409, code: "AI_NOT_CONFIGURED" });
    expect(save).not.toHaveBeenCalled();
  });

  it("PUT can switch Ivy off, or set a ceiling, with no key", async () => {
    integration.mockResolvedValue(null);
    await put({ enabled: false, monthlyCeilingUsd: 10 });
    await put({ enabled: false, monthlyCeilingUsd: null });
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("PUT rejects junk", async () => {
    for (const body of [{}, { enabled: "yes", monthlyCeilingUsd: 5 }, { enabled: false, monthlyCeilingUsd: -1 }]) {
      await expect(put(body)).rejects.toMatchObject({ status: 422 });
    }
    expect(save).not.toHaveBeenCalled();
  });
});

describe("PUT /api/admin/integrations/anthropic", () => {
  it("checks the key with Anthropic and then stores it", async () => {
    const res = await putKey({ apiKey: KEY });
    expect(res.status).toBe(200);
    expect(verify).toHaveBeenCalledWith(KEY);
    expect(saveIntegration).toHaveBeenCalledWith("t1", "ANTHROPIC", { apiKey: KEY }, "u1");
    expect(verify.mock.invocationCallOrder[0]).toBeLessThan(saveIntegration.mock.invocationCallOrder[0]);
  });

  it("does not store a key Anthropic rejects", async () => {
    verify.mockRejectedValue(Object.assign(new Error("Anthropic did not accept this key."), { status: 422, code: "AI_KEY_REJECTED" }));
    await expect(putKey({ apiKey: KEY })).rejects.toMatchObject({ code: "AI_KEY_REJECTED" });
    expect(saveIntegration).not.toHaveBeenCalled();
  });

  it("does not even call Anthropic for something that is not shaped like a key", async () => {
    for (const apiKey of ["", "sk_test_123", "not a key", "sk-ant-short"]) await expect(putKey({ apiKey })).rejects.toMatchObject({ status: 422 });
    expect(verify).not.toHaveBeenCalled();
    expect(saveIntegration).not.toHaveBeenCalled();
  });

  it("never returns the key in its response", async () => {
    const res = await putKey({ apiKey: KEY });
    expect(await res.text()).not.toContain("sk-ant");
  });
});
