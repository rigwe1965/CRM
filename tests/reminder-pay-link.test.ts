import { beforeEach, describe, expect, it, vi } from "vitest";

const { tx, db, stripeApi, configured, audit } = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    deal: { findFirst: vi.fn() },
    payment: { aggregate: vi.fn() },
    paymentLink: { aggregate: vi.fn(), create: vi.fn() },
  };
  const db = {
    paymentLink: { findFirst: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { tx, db, stripeApi: { paymentLinks: { create: vi.fn() } }, configured: vi.fn(), audit: vi.fn() };
});
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/platform-db", () => ({ platformDb: {} }));
vi.mock("@/lib/audit", () => ({ audit }));
vi.mock("@/lib/stripe", () => ({
  ONLINE_CURRENCIES: ["USD", "EUR"],
  stripe: async () => stripeApi,
  stripeConfigured: configured,
  toMinorUnits: (n: number) => Math.round(n * 100),
}));

import { reminderPayLink } from "@/lib/payment-links";

const user = { id: "owner1", tenantId: "t1", email: "automation" };
const deal = { id: "d1", title: "Adaeze order" };
const BASE = "https://crm.test";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  configured.mockResolvedValue(true);
  db.paymentLink.findFirst.mockResolvedValue(null);
  tx.deal.findFirst.mockResolvedValue({ amount: 300, currency: "USD", deletedAt: null });
  tx.payment.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
  tx.paymentLink.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
  tx.paymentLink.create.mockImplementation(async ({ data }) => ({ id: "l1", ...data }));
  db.paymentLink.update.mockImplementation(async ({ data }) => ({ id: "l1", amount: 100, currency: "USD", ...data }));
  stripeApi.paymentLinks.create.mockResolvedValue({ id: "plink_1", url: "https://buy.stripe.test/x" });
});

describe("reminderPayLink", () => {
  it("creates a link for exactly the amount due, as the deal owner, and audits it", async () => {
    expect(await reminderPayLink(user, deal, 100, "USD", BASE)).toBe("https://buy.stripe.test/x");
    expect(tx.paymentLink.create.mock.calls[0][0].data).toMatchObject({ tenantId: "t1", dealId: "d1", amount: 100, createdById: "owner1" });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "t1" }), expect.objectContaining({ action: "payment_link.created", entityId: "d1" }));
  });

  it("reuses an open link for the same amount instead of reserving more of the balance", async () => {
    db.paymentLink.findFirst.mockResolvedValue({ url: "https://buy.stripe.test/open" });
    expect(await reminderPayLink(user, deal, 100, "USD", BASE)).toBe("https://buy.stripe.test/open");
    expect(db.paymentLink.findFirst.mock.calls[0][0].where).toMatchObject({ tenantId: "t1", dealId: "d1", status: "PENDING", currency: "USD", amount: 100 });
    expect(tx.paymentLink.create).not.toHaveBeenCalled();
    expect(stripeApi.paymentLinks.create).not.toHaveBeenCalled();
  });

  it("returns null, without touching Stripe, when online payment is off or the currency is not supported", async () => {
    configured.mockResolvedValue(false);
    expect(await reminderPayLink(user, deal, 100, "USD", BASE)).toBeNull();
    configured.mockResolvedValue(true);
    expect(await reminderPayLink(user, deal, 100, "NGN", BASE)).toBeNull();
    expect(await reminderPayLink(user, deal, 0, "USD", BASE)).toBeNull();
    expect(stripeApi.paymentLinks.create).not.toHaveBeenCalled();
  });

  it("returns null instead of throwing when a link cannot be made", async () => {
    stripeApi.paymentLinks.create.mockRejectedValue(new Error("boom"));
    expect(await reminderPayLink(user, deal, 100, "USD", BASE)).toBeNull();
    tx.paymentLink.aggregate.mockResolvedValue({ _sum: { amount: 300 } }); // open links already cover the balance
    expect(await reminderPayLink(user, deal, 100, "USD", BASE)).toBeNull();
  });
});
