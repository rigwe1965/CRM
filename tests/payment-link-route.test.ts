import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, createPaymentLink } = vi.hoisted(() => ({
  db: { deal: { findFirst: vi.fn() } },
  createPaymentLink: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/mail", () => ({ appUrl: () => "https://crm.test" }));
vi.mock("@/lib/stripe", () => ({ stripe: vi.fn(), stripeConfigured: () => true }));
vi.mock("@/lib/payment-links", () => ({ createPaymentLink, paymentLinksView: vi.fn(async () => []) }));
// Skip auth and rate limiting: this test is about the URL handed to Stripe.
vi.mock("@/lib/route", () => ({
  authed:
    (handler: (ctx: unknown) => Promise<Response>) =>
    async (req: Request, context: { params: Promise<unknown> }) =>
      handler({ req, user: { id: "u1", role: "SALES" }, params: await context.params }),
}));

import { POST } from "@/app/api/deals/[id]/payment-links/route";

beforeEach(() => {
  vi.clearAllMocks();
  db.deal.findFirst.mockResolvedValue({ id: "d1", title: "Adaeze order" });
  createPaymentLink.mockResolvedValue({ id: "l1", amount: 100, currency: "USD" });
});

describe("POST /api/deals/:id/payment-links", () => {
  it("sends Stripe back to the configured URL, whatever Host the request claims", async () => {
    const req = new Request("http://evil.test/api/deals/d1/payment-links", {
      method: "POST",
      headers: { "Content-Type": "application/json", host: "evil.test", "x-forwarded-host": "evil.test" },
      body: JSON.stringify({}),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "d1" }) });
    expect(res.status).toBe(201);
    expect(createPaymentLink.mock.calls[0][3]).toBe("https://crm.test");
  });
});
