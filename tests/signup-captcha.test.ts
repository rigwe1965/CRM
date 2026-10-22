import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The CAPTCHA on the public sign-up route. Cloudflare is never called: fetch is replaced.

const { createSignup } = vi.hoisted(() => ({ createSignup: vi.fn(async () => ({})) }));
vi.mock("@/lib/signup", () => ({ signupEnabled: () => true, createSignup }));
vi.mock("@/lib/rate-limit", () => ({ clientIp: () => "203.0.113.9", LIMITS: { signup: {}, signupEmail: {}, signupAll: {} }, rateLimit: async () => ({ allowed: true, retryAfter: 0 }) }));

import { POST } from "@/app/api/signup/route";
import { captchaConfigured, verifyCaptcha } from "@/lib/captcha";
import { buildCsp } from "@/lib/csp";

const body = { businessName: "Fresh Hair Co", name: "Nia Okoro", email: "nia@fresh.test", password: "Sup3r-secret-pw" };
const post = (extra: object = {}) => POST(new Request("http://x.test/api/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, ...extra }) }));

const real = globalThis.fetch;
let sent: Record<string, string>[];
const cloudflare = (ok: (token: string) => boolean) => {
  globalThis.fetch = vi.fn(async (_u: unknown, init?: RequestInit) => {
    const form = Object.fromEntries(new URLSearchParams(String(init?.body)));
    sent.push(form);
    return new Response(JSON.stringify({ success: ok(form.response) }), { status: 200 });
  }) as typeof fetch;
};

beforeEach(() => {
  sent = [];
  createSignup.mockClear();
  process.env.TURNSTILE_SITE_KEY = "site-key";
  process.env.TURNSTILE_SECRET_KEY = "secret-key";
});
afterEach(() => {
  globalThis.fetch = real;
  delete process.env.TURNSTILE_SITE_KEY;
  delete process.env.TURNSTILE_SECRET_KEY;
});

describe("sign-up CAPTCHA", () => {
  it("is off until both keys are set (development)", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    expect(captchaConfigured()).toBe(false);
    expect((await post()).status).toBe(200);
    expect(createSignup).toHaveBeenCalledTimes(1);
  });

  it("refuses a missing or wrong token without creating anything", async () => {
    cloudflare((t) => t === "good-token");
    const none = await post();
    expect(none.status).toBe(400);
    expect(await none.json()).toMatchObject({ code: "CAPTCHA_FAILED" });
    expect((await post({ captchaToken: "bad-token" })).status).toBe(400);
    expect(createSignup).not.toHaveBeenCalled();
  });

  it("refuses when Cloudflare can't be reached or answers badly", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as typeof fetch;
    expect((await post({ captchaToken: "good-token" })).status).toBe(400);
    globalThis.fetch = vi.fn(async () => new Response("oops", { status: 502 })) as typeof fetch;
    expect(await verifyCaptcha("good-token")).toBe(false);
    expect(createSignup).not.toHaveBeenCalled();
  });

  it("lets a confirmed token through, sends Cloudflare only the secret, token and address, and keeps the token out of the signup", async () => {
    cloudflare((t) => t === "good-token");
    expect((await post({ captchaToken: "good-token" })).status).toBe(200);
    expect(sent).toEqual([{ secret: "secret-key", response: "good-token", remoteip: "203.0.113.9" }]);
    expect(createSignup).toHaveBeenCalledWith(body);
  });

  it("is allowed to draw its box by the page's security policy, and nothing else new", () => {
    const csp = buildCsp("n", false);
    expect(csp).toContain("frame-src https://challenges.cloudflare.com;");
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*cloudflare/); // the script is trusted through the page's own nonce
  });
});
