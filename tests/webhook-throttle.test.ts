import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Public webhooks are throttled per sender address before any database work, and an unconfigured business is
// indistinguishable from a bad signature.

const { getIntegration } = vi.hoisted(() => ({ getIntegration: vi.fn() }));
vi.mock("@/lib/integrations", () => ({ getIntegration }));
vi.mock("@/lib/tenant-context", () => ({ withTenant: (_id: string, fn: () => unknown) => fn() }));
vi.mock("@/lib/ai/triage/run", () => ({ enqueueTriage: vi.fn(async () => []), processTriage: vi.fn() }));
vi.mock("@/lib/whatsapp", async (orig) => ({ ...(await orig<typeof import("@/lib/whatsapp")>()), recordInbound: vi.fn(async () => "duplicate") }));

import { handleStripeWebhook } from "@/lib/stripe-webhook";
import { receiveWhatsappWebhook, verifyWhatsappWebhook } from "@/lib/whatsapp-webhook";
import { LIMITS } from "@/lib/rate-limit";

let n = 0;
const ip = () => `198.51.100.${(n = (n % 250) + 1)}`;
const stripeReq = (addr: string) => new Request("http://x.test", { method: "POST", headers: { "x-forwarded-for": addr, "stripe-signature": "t=1,v1=x" }, body: "{}" });
const waReq = (addr: string, secret = "s3cret") => {
  const raw = "{}";
  return new Request("http://x.test", { method: "POST", headers: { "x-forwarded-for": addr, "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}` }, body: raw });
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VERCEL", "1");
  getIntegration.mockResolvedValue(null);
});

describe("webhook throttle", () => {
  it("refuses an address over the limit before touching the database", async () => {
    const addr = ip();
    for (let i = 0; i < LIMITS.webhookIp.max; i++) await handleStripeWebhook(stripeReq(addr), "t1");
    getIntegration.mockClear();
    const res = await handleStripeWebhook(stripeReq(addr), "t1");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(getIntegration).not.toHaveBeenCalled();
  });

  it("counts addresses and webhook kinds separately", async () => {
    const a = ip();
    for (let i = 0; i < LIMITS.webhookIp.max + 1; i++) await handleStripeWebhook(stripeReq(a), "t1");
    expect((await handleStripeWebhook(stripeReq(ip()), "t1")).status).toBe(400);
    expect((await receiveWhatsappWebhook(waReq(a), "t1")).status).toBe(401);
  });

  it("answers an unconfigured business exactly like a bad signature", async () => {
    // Stripe
    const unknown = await handleStripeWebhook(stripeReq(ip()), "no_such_business");
    expect(unknown.status).toBe(400);
    // WhatsApp POST: unconfigured vs configured with the wrong secret
    const none = await receiveWhatsappWebhook(waReq(ip()), "no_such_business");
    getIntegration.mockResolvedValue({ settings: { appSecret: "real-secret", verifyToken: "tok" } });
    const wrong = await receiveWhatsappWebhook(waReq(ip(), "other-secret"), "t1");
    expect(none.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(await none.text()).toBe(await wrong.text());
  });

  it("answers Meta's check for an unconfigured business like a wrong token", async () => {
    const url = "http://x.test/?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=abc";
    const none = await verifyWhatsappWebhook(new Request(url, { headers: { "x-forwarded-for": ip() } }), "no_such_business");
    getIntegration.mockResolvedValue({ settings: { appSecret: "s", verifyToken: "right-token-1234567" } });
    const wrong = await verifyWhatsappWebhook(new Request(url, { headers: { "x-forwarded-for": ip() } }), "t1");
    expect(none.status).toBe(403);
    expect(wrong.status).toBe(403);
  });

  it("still lets a correctly signed WhatsApp message through", async () => {
    getIntegration.mockResolvedValue({ settings: { appSecret: "s3cret", verifyToken: "tok" } });
    expect((await receiveWhatsappWebhook(waReq(ip()), "t1")).status).toBe(200);
  });
});
