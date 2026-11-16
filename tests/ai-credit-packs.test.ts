import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type Stripe from "stripe";

const { platformDb } = vi.hoisted(() => ({
  platformDb: {
    tenant: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    aiCredit: { create: vi.fn() },
  },
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/platform-db", () => ({ platformDb }));
vi.mock("@/lib/mail", () => ({ appUrl: () => "https://crm.test" }));

import { applyCreditEvent, CREDIT_PACKS, creditCheckoutParams, packById, startCreditCheckout } from "@/lib/ai/credit-packs";

const session = (over: Record<string, unknown> = {}) => ({
  id: "cs_1",
  mode: "payment",
  payment_status: "paid",
  customer: "cus_1",
  currency: "usd",
  amount_subtotal: 1000,
  metadata: { kind: "ai_credit_pack", tenantId: "t1", packId: "pack10" },
  ...over,
});
const event = (obj: unknown, type = "checkout.session.completed") => ({ id: "evt_1", type, data: { object: obj } }) as unknown as Stripe.Event;

beforeEach(() => {
  vi.clearAllMocks();
  platformDb.tenant.findUnique.mockResolvedValue({ id: "t1" });
  platformDb.aiCredit.create.mockResolvedValue({});
});
afterEach(() => vi.unstubAllEnvs());

describe("the packs", () => {
  it("are the owner's Balanced prices: $10 buys $5 of AI, $25 buys $12.50", () => {
    expect(CREDIT_PACKS.map((p) => [p.id, p.priceCents, p.creditMicros])).toEqual([
      ["pack10", 1000, 5_000_000],
      ["pack25", 2500, 12_500_000],
    ]);
  });
  it("never give away more AI than the customer paid for", () => {
    for (const p of CREDIT_PACKS) expect(p.creditMicros / 1_000_000).toBeLessThan(p.priceCents / 100);
  });
  it("are found by id only", () => {
    expect(packById("pack25")?.priceCents).toBe(2500);
    expect(packById("pack999")).toBeUndefined();
    expect(packById(undefined)).toBeUndefined();
  });
});

describe("creditCheckoutParams", () => {
  const base = { customer: "cus_1", tenantId: "t1", packId: "pack10" as const, baseUrl: "https://crm.test" };
  it("is a one-time payment in US dollars at the pack's price, with the business and pack in the metadata", () => {
    vi.stubEnv("BILLING_AUTOMATIC_TAX", "");
    const p = creditCheckoutParams(base);
    expect(p.mode).toBe("payment");
    expect(p.line_items?.[0]).toMatchObject({ quantity: 1, price_data: { currency: "usd", unit_amount: 1000 } });
    expect(p.metadata).toEqual({ kind: "ai_credit_pack", tenantId: "t1", packId: "pack10" });
    expect(p.payment_intent_data?.metadata).toEqual(p.metadata);
    expect(p.automatic_tax).toBeUndefined();
  });
  it("asks for tax handling only once Stripe Tax is on, and then marks the price tax-exclusive", () => {
    vi.stubEnv("BILLING_AUTOMATIC_TAX", "1");
    const p = creditCheckoutParams(base);
    expect(p.automatic_tax).toEqual({ enabled: true });
    expect((p.line_items?.[0].price_data as { tax_behavior?: string }).tax_behavior).toBe("exclusive");
  });
});

describe("startCreditCheckout", () => {
  const user = { id: "u1", tenantId: "t1", email: "a@b.test" };
  it("refuses while billing is not set up", async () => {
    vi.stubEnv("BILLING_STRIPE_SECRET_KEY", "");
    await expect(startCreditCheckout(user, "pack10")).rejects.toMatchObject({ code: "BILLING_NOT_CONFIGURED" });
  });
  it("refuses while included AI is not switched on (no platform key)", async () => {
    vi.stubEnv("BILLING_STRIPE_SECRET_KEY", "sk_test_x");
    vi.stubEnv("BILLING_STRIPE_WEBHOOK_SECRET", "whsec_x");
    vi.stubEnv("INCLUDED_AI_ANTHROPIC_KEY", "");
    await expect(startCreditCheckout(user, "pack10")).rejects.toMatchObject({ code: "AI_CREDIT_UNAVAILABLE" });
  });
  it("refuses a read-only business: it must sort out its plan first", async () => {
    vi.stubEnv("BILLING_STRIPE_SECRET_KEY", "sk_test_x");
    vi.stubEnv("BILLING_STRIPE_WEBHOOK_SECRET", "whsec_x");
    vi.stubEnv("INCLUDED_AI_ANTHROPIC_KEY", "sk-ant-x");
    platformDb.tenant.findUniqueOrThrow.mockResolvedValue({ name: "Shop", stripeCustomerId: "cus_1", status: "ACTIVE", plan: "starter", billingStatus: "CANCELED", trialEndsAt: null, currentPeriodEnd: new Date("2026-01-01"), deletionRequestedAt: null });
    await expect(startCreditCheckout(user, "pack10")).rejects.toMatchObject({ code: "AI_CREDIT_PLAN_REQUIRED" });
  });
});

describe("applyCreditEvent", () => {
  it("adds the pack's credit once, using the Checkout Session id as the reference", async () => {
    const r = await applyCreditEvent(event(session()));
    expect(r).toEqual({ outcome: "applied", tenantId: "t1", amountMicros: 5_000_000 });
    expect(platformDb.aiCredit.create).toHaveBeenCalledWith({ data: { tenantId: "t1", amountMicros: 5_000_000, source: "PACK", reference: "cs_1", note: "pack10" } });
  });
  it("finds the business by the Stripe customer we stored, not by the event's metadata", async () => {
    await applyCreditEvent(event(session()));
    expect(platformDb.tenant.findUnique).toHaveBeenCalledWith({ where: { stripeCustomerId: "cus_1" }, select: { id: true } });
  });
  it("takes the credit from the pack table, not from anything in the event", async () => {
    await applyCreditEvent(event(session({ metadata: { kind: "ai_credit_pack", tenantId: "t1", packId: "pack10", creditMicros: "999999999" } })));
    expect(platformDb.aiCredit.create.mock.calls[0][0].data.amountMicros).toBe(5_000_000);
  });
  it("adds nothing the second time the same payment is reported", async () => {
    platformDb.aiCredit.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }));
    expect((await applyCreditEvent(event(session()))).outcome).toBe("duplicate");
  });
  it("lets other database errors through, so Stripe retries", async () => {
    platformDb.aiCredit.create.mockRejectedValue(new Error("db down"));
    await expect(applyCreditEvent(event(session()))).rejects.toThrow("db down");
  });
  it("waits for an unpaid session (a bank debit) and credits on the later async event", async () => {
    expect((await applyCreditEvent(event(session({ payment_status: "unpaid" })))).outcome).toBe("unpaid");
    expect(platformDb.aiCredit.create).not.toHaveBeenCalled();
    expect((await applyCreditEvent(event(session(), "checkout.session.async_payment_succeeded"))).outcome).toBe("applied");
  });
  it("ignores everything that is not an AI credit pack (plan subscriptions, other events)", async () => {
    expect((await applyCreditEvent(event(session({ mode: "subscription" })))).outcome).toBe("ignored");
    expect((await applyCreditEvent(event(session({ metadata: {} })))).outcome).toBe("ignored");
    expect((await applyCreditEvent(event(session({ metadata: { kind: "ai_credit_pack", packId: "nope", tenantId: "t1" } })))).outcome).toBe("ignored");
    expect((await applyCreditEvent(event(session(), "customer.subscription.updated"))).outcome).toBe("ignored");
    expect(platformDb.aiCredit.create).not.toHaveBeenCalled();
  });
  it("adds nothing for an unknown Stripe customer", async () => {
    platformDb.tenant.findUnique.mockResolvedValue(null);
    expect((await applyCreditEvent(event(session()))).outcome).toBe("unknown_customer");
    expect(platformDb.aiCredit.create).not.toHaveBeenCalled();
  });
  it("adds nothing when the metadata names a different business than the customer belongs to", async () => {
    expect((await applyCreditEvent(event(session({ metadata: { kind: "ai_credit_pack", tenantId: "other", packId: "pack10" } })))).outcome).toBe("mismatch");
    expect(platformDb.aiCredit.create).not.toHaveBeenCalled();
  });
  it("adds nothing when the amount or currency is not the pack's price", async () => {
    expect((await applyCreditEvent(event(session({ amount_subtotal: 100 })))).outcome).toBe("mismatch");
    expect((await applyCreditEvent(event(session({ currency: "eur" })))).outcome).toBe("mismatch");
    expect(platformDb.aiCredit.create).not.toHaveBeenCalled();
  });
  it("still credits when Stripe added tax on top (the subtotal is checked, not the total)", async () => {
    expect((await applyCreditEvent(event(session({ amount_subtotal: 1000, amount_total: 1200 })))).outcome).toBe("applied");
  });
});
