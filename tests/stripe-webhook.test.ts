import { beforeEach, describe, expect, it, vi } from "vitest";

const { constructEvent, record } = vi.hoisted(() => ({ constructEvent: vi.fn(), record: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ stripe: () => ({ webhooks: { constructEvent } }) }));
vi.mock("@/lib/payment-links", () => ({ recordOnlinePayment: record, auditOnline: vi.fn() }));

import { POST } from "@/app/api/webhooks/stripe/route";
import { isPublicPath } from "@/lib/rbac";

const call = (headers: Record<string, string> = { "stripe-signature": "t=1,v1=x" }) =>
  POST(new Request("http://x.test/api/webhooks/stripe", { method: "POST", headers, body: "{}" }));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
});

describe("stripe webhook", () => {
  it("is reachable without a session", () => {
    expect(isPublicPath("/api/webhooks/stripe")).toBe(true);
    expect(isPublicPath("/pay/result")).toBe(true);
  });

  it("is off until the secret is set", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect((await call()).status).toBe(503);
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
    expect(record).toHaveBeenCalledWith({ id: "cs_1" });
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
});
