import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The CAPTCHA on the website lead form. Cloudflare is never called: fetch is replaced.

const { captureWebLead } = vi.hoisted(() => ({ captureWebLead: vi.fn(async () => ({})) }));
vi.mock("@/lib/db", () => ({ db: { tenant: { findFirst: vi.fn(async () => ({ id: "t1" })) } } }));
vi.mock("@/lib/tenant-context", () => ({ withTenant: async (_t: string, fn: () => unknown) => fn() }));
vi.mock("@/lib/web-lead", () => ({ allowedOrigins: async () => [], captureWebLead }));
vi.mock("@/lib/rate-limit", () => ({ clientIp: () => "203.0.113.9", LIMITS: { webLead: {}, webLeadAll: {} }, rateLimit: async () => ({ allowed: true, retryAfter: 0 }) }));

import { leadPost } from "@/lib/web-lead-handler";

const lead = { name: "Nia Okoro", email: "nia@fresh.test", message: "Hello" };
const post = (extra: object = {}) => leadPost(new Request("http://x.test/api/public/lead/t1", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...lead, ...extra }) }), "t1");

const real = globalThis.fetch;
const cloudflare = (ok: (token: string) => boolean) => {
  globalThis.fetch = vi.fn(async (_u: unknown, init?: RequestInit) => new Response(JSON.stringify({ success: ok(new URLSearchParams(String(init?.body)).get("response") ?? "") }), { status: 200 })) as typeof fetch;
};

beforeEach(() => {
  captureWebLead.mockClear();
  process.env.TURNSTILE_SITE_KEY = "site-key";
  process.env.TURNSTILE_SECRET_KEY = "secret-key";
});
afterEach(() => {
  globalThis.fetch = real;
  delete process.env.TURNSTILE_SITE_KEY;
  delete process.env.TURNSTILE_SECRET_KEY;
});

describe("website lead form CAPTCHA", () => {
  it("lets a form with no token through, so forms pasted before the CAPTCHA keep working", async () => {
    expect((await post()).status).toBe(200);
    expect(captureWebLead).toHaveBeenCalledTimes(1);
  });

  it("refuses a wrong token, or one Cloudflare can't confirm, without saving a lead", async () => {
    cloudflare((t) => t === "good-token");
    const res = await post({ captchaToken: "bad-token" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "CAPTCHA_FAILED" });
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as typeof fetch;
    expect((await post({ captchaToken: "good-token" })).status).toBe(400);
    expect(captureWebLead).not.toHaveBeenCalled();
  });

  it("saves the lead for a confirmed token, and keeps the token out of it", async () => {
    cloudflare((t) => t === "good-token");
    expect((await post({ captchaToken: "good-token" })).status).toBe(200);
    expect(captureWebLead).toHaveBeenCalledWith("t1", expect.not.objectContaining({ captchaToken: expect.anything() }));
  });

  it("ignores a token when no keys are set (development)", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    expect((await post({ captchaToken: "anything" })).status).toBe(200);
  });
});
