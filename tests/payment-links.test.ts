import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const { tx, db, stripeApi } = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    deal: { findUnique: vi.fn() },
    payment: { aggregate: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    paymentLink: { aggregate: vi.fn(), create: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    task: { create: vi.fn() },
  };
  const db = {
    paymentLink: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const stripeApi = { paymentLinks: { create: vi.fn(), update: vi.fn() } };
  return { tx, db, stripeApi };
});
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/stripe", async (orig) => ({ ...(await orig<typeof import("@/lib/stripe")>()), stripe: () => stripeApi }));

import { cancelPaymentLink, createPaymentLink, recordOnlinePayment } from "@/lib/payment-links";

const user = { id: "u1" };
const deal = { id: "d1", title: "Adaeze order" };
const BASE = "https://crm.test";

function mockDeal(amount: number, paid: number, reserved = 0, extra: Record<string, unknown> = {}) {
  tx.deal.findUnique.mockResolvedValue({ amount, currency: "USD", deletedAt: null, ...extra });
  tx.payment.aggregate.mockResolvedValue({ _sum: { amount: paid } });
  tx.paymentLink.aggregate.mockResolvedValue({ _sum: { amount: reserved } });
}

beforeEach(() => {
  vi.clearAllMocks();
  tx.paymentLink.create.mockImplementation(async ({ data }) => ({ id: "l1", ...data }));
  db.paymentLink.update.mockImplementation(async ({ data }) => ({ id: "l1", amount: 100, currency: "USD", ...data }));
  stripeApi.paymentLinks.create.mockResolvedValue({ id: "plink_1", url: "https://buy.stripe.test/x" });
});

describe("createPaymentLink", () => {
  it("defaults to everything left to collect and sends cents to Stripe", async () => {
    mockDeal(300, 100);
    await createPaymentLink(user, deal, {}, BASE);
    expect(tx.paymentLink.create.mock.calls[0][0].data.amount).toBe(200);
    const args = stripeApi.paymentLinks.create.mock.calls[0][0];
    expect(args.line_items[0].price_data).toMatchObject({ currency: "usd", unit_amount: 20000 });
    expect(args.restrictions).toEqual({ completed_sessions: { limit: 1 } });
    expect(args.metadata.paymentLinkId).toBe("l1");
  });

  it("counts open links as already collected", async () => {
    mockDeal(300, 100, 150);
    await expect(createPaymentLink(user, deal, { amount: 100 }, BASE)).rejects.toMatchObject({ status: 422 });
    expect(tx.paymentLink.create).not.toHaveBeenCalled();
    await createPaymentLink(user, deal, { amount: 50 }, BASE);
    expect(tx.paymentLink.create).toHaveBeenCalledOnce();
  });

  it("refuses when nothing is left", async () => {
    mockDeal(300, 300);
    await expect(createPaymentLink(user, deal, {}, BASE)).rejects.toMatchObject({ code: "NOTHING_TO_COLLECT" });
  });

  it("refuses currencies other than USD and EUR", async () => {
    mockDeal(300, 0, 0, { currency: "NGN" });
    await expect(createPaymentLink(user, deal, {}, BASE)).rejects.toMatchObject({ code: "CURRENCY_NOT_SUPPORTED" });
    expect(stripeApi.paymentLinks.create).not.toHaveBeenCalled();
  });

  it("releases the reserved amount when Stripe fails", async () => {
    mockDeal(300, 0);
    stripeApi.paymentLinks.create.mockRejectedValue(new Error("boom"));
    await expect(createPaymentLink(user, deal, {}, BASE)).rejects.toMatchObject({ status: 502 });
    expect(db.paymentLink.update).toHaveBeenCalledWith({ where: { id: "l1" }, data: { status: "CANCELLED" } });
  });
});

describe("cancelPaymentLink", () => {
  it("switches the link off at Stripe before closing it here", async () => {
    db.paymentLink.findFirst.mockResolvedValue({ id: "l1", status: "PENDING", providerLinkId: "plink_1" });
    db.paymentLink.updateMany.mockResolvedValue({ count: 1 });
    await cancelPaymentLink("d1", "l1");
    expect(stripeApi.paymentLinks.update).toHaveBeenCalledWith("plink_1", { active: false });
  });

  it("keeps the link open if Stripe can't switch it off", async () => {
    db.paymentLink.findFirst.mockResolvedValue({ id: "l1", status: "PENDING", providerLinkId: "plink_1" });
    stripeApi.paymentLinks.update.mockRejectedValue(new Error("down"));
    await expect(cancelPaymentLink("d1", "l1")).rejects.toMatchObject({ status: 502 });
    expect(db.paymentLink.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a link that is no longer open", async () => {
    db.paymentLink.findFirst.mockResolvedValue({ id: "l1", status: "PAID", providerLinkId: "plink_1" });
    await expect(cancelPaymentLink("d1", "l1")).rejects.toMatchObject({ status: 409 });
  });
});

describe("recordOnlinePayment", () => {
  const session = (over: Partial<Stripe.Checkout.Session> = {}) =>
    ({ payment_status: "paid", payment_link: "plink_1", payment_intent: "pi_1", amount_total: 10000, currency: "usd", ...over }) as Stripe.Checkout.Session;
  const link = (over: Record<string, unknown> = {}) => ({ id: "l1", dealId: "d1", amount: 100, status: "PENDING", ...over });
  const dealRow = (over: Record<string, unknown> = {}) => ({
    id: "d1", title: "Adaeze order", amount: 300, currency: "USD", ownerId: "owner1", contactId: "c1", deletedAt: null, ...over,
  });

  beforeEach(() => {
    db.paymentLink.findUnique.mockResolvedValue({ id: "l1", dealId: "d1" });
    tx.paymentLink.findUniqueOrThrow.mockResolvedValue(link());
    tx.payment.findUnique.mockResolvedValue(null);
    tx.deal.findUnique.mockResolvedValue(dealRow());
    tx.payment.aggregate.mockResolvedValue({ _sum: { amount: 100 } });
  });

  it("records a paid session as a DIGITAL payment and closes the link", async () => {
    const r = await recordOnlinePayment(session());
    expect(r.outcome).toBe("recorded");
    expect(tx.payment.create.mock.calls[0][0].data).toMatchObject({
      dealId: "d1", amount: 100, method: "DIGITAL", source: "ONLINE", providerRef: "pi_1", paymentLinkId: "l1",
    });
    expect(tx.paymentLink.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PAID" }) }));
    expect(tx.task.create).not.toHaveBeenCalled();
  });

  it("ignores a repeated delivery of the same payment", async () => {
    tx.payment.findUnique.mockResolvedValue({ id: "p1" });
    expect((await recordOnlinePayment(session())).outcome).toBe("duplicate");
    tx.payment.findUnique.mockResolvedValue(null);
    tx.paymentLink.findUniqueOrThrow.mockResolvedValue(link({ status: "PAID" }));
    expect((await recordOnlinePayment(session())).outcome).toBe("duplicate");
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it("does not record unpaid sessions or links we don't know", async () => {
    expect((await recordOnlinePayment(session({ payment_status: "unpaid" }))).outcome).toBe("not_paid");
    db.paymentLink.findUnique.mockResolvedValue(null);
    expect((await recordOnlinePayment(session())).outcome).toBe("unknown_link");
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it("flags a refund instead of breaking the balance rule when the balance dropped", async () => {
    tx.payment.aggregate.mockResolvedValue({ _sum: { amount: 250 } }); // only 50 left, customer paid 100
    const r = await recordOnlinePayment(session());
    expect(r.outcome).toBe("refund_needed");
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(tx.paymentLink.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "REFUND_NEEDED" }) }));
    expect(tx.task.create.mock.calls[0][0].data).toMatchObject({ priority: "URGENT", assigneeId: "owner1", dealId: "d1" });
  });

  it("flags a refund when the link was cancelled, the deal deleted, or the amount differs", async () => {
    tx.paymentLink.findUniqueOrThrow.mockResolvedValue(link({ status: "CANCELLED" }));
    expect((await recordOnlinePayment(session())).outcome).toBe("refund_needed");
    tx.paymentLink.findUniqueOrThrow.mockResolvedValue(link());
    tx.deal.findUnique.mockResolvedValue(dealRow({ deletedAt: new Date() }));
    expect((await recordOnlinePayment(session())).outcome).toBe("refund_needed");
    tx.deal.findUnique.mockResolvedValue(dealRow());
    expect((await recordOnlinePayment(session({ amount_total: 9000 }))).outcome).toBe("refund_needed");
    expect((await recordOnlinePayment(session({ currency: "eur" }))).outcome).toBe("refund_needed");
    expect(tx.payment.create).not.toHaveBeenCalled();
  });
});
