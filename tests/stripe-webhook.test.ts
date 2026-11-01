import { beforeEach, describe, expect, it, vi } from "vitest";

const { constructEvent, record } = vi.hoisted(() => ({ constructEvent: vi.fn(), record: vi.fn() }));
// No saved settings in the database, so the original business falls back to the environment variables; any other
// business has nothing.
vi.mock("@/lib/db", () => ({ db: { tenantIntegration: { findFirst: vi.fn(async () => null) } } }));
vi.mock("@/lib/stripe", () => ({ stripe: async () => ({ webhooks: { constructEvent } }) }));
vi.mock("@/lib/payment-links", () => ({ recordOnlinePayment: record, auditOnline: vi.fn() }));

import { POST } from "@/app/api/webhooks/stripe/route";
import { POST as postFor } from "@/app/api/webhooks/stripe/[tenant]/route";
import { isPublicPath } from "@/lib/rbac";

const call = (headers: Record<string, string> = { "stripe-signature": "t=1,v1=x" }) =>
  POST(new Request("http://x.test/api/webhooks/stripe", { method: "POST", headers, body: "{}" }));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  process.env.STRIPE_SECRET_KEY = "sk_test_abc123";
});

describe("stripe webhook", () => {
  it("is reachable without a session", () => {
    expect(isPublicPath("/api/webhooks/stripe")).toBe(true);
    expect(isPublicPath("/pay/result")).toBe(true);
  });

  it("is off until the secret is set", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect((await call()).status).toBe(400);
  });

  it("rejects a missing or invalid signature without touching the database", async () => {
    expect((await call({})).status).toBe(400);
    constructEvent.mockImplementation(() => {
      throw new Error("bad signature");
    });
    expect((await call()).status).toBe(400);
    expect(record).not.toHaveBeenCalled();
  });

  it("records a paid checkout session", async () => {
    constructEvent.mockReturnValue({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1" } } });
    record.mockResolvedValue({ outcome: "recorded", dealId: "d1", summary: "100.00 USD" });
    const res = await call();
    expect(res.status).toBe(200);
    expect(record).toHaveBeenCalledWith({ id: "cs_1" }, "tenant_ivycandy");
  });

  it("acknowledges and ignores other events", async () => {
    constructEvent.mockReturnValue({ id: "evt_2", type: "charge.refunded", data: { object: {} } });
    expect((await call()).status).toBe(200);
    expect(record).not.toHaveBeenCalled();
  });

  it("asks Stripe to retry when recording fails", async () => {
    constructEvent.mockReturnValue({ id: "evt_3", type: "checkout.session.completed", data: { object: {} } });
    record.mockRejectedValue(new Error("db down"));
    expect((await call()).status).toBe(500);
  });

  it("takes the business from the address, and only the original business falls back to the environment", async () => {
    const other = () =>
      postFor(new Request("http://x.test/api/webhooks/stripe/tenant_b", { method: "POST", headers: { "stripe-signature": "t=1,v1=x" }, body: "{}" }), { params: Promise.resolve({ tenant: "tenant_b" }) });
    // tenant_b has saved nothing: the environment keys are the original business's and are never used for it.
    expect((await other()).status).toBe(400);
    expect(constructEvent).not.toHaveBeenCalled();
    const original = await postFor(new Request("http://x.test", { method: "POST", headers: { "stripe-signature": "t=1,v1=x" }, body: "{}" }), { params: Promise.resolve({ tenant: "tenant_ivycandy" }) });
    expect(original.status).not.toBe(400);
  });
});
