import { beforeEach, describe, expect, it, vi } from "vitest";

// The deal is read once before the row lock and again under it. These tests make the two reads
// disagree, as they would if another request committed an edit while this one waited for the lock.
const { tx, db } = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    deal: { findUnique: vi.fn(), update: vi.fn() },
    payment: { aggregate: vi.fn(), create: vi.fn() },
  };
  const db = {
    deal: { findFirst: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { tx, db };
});
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/route", () => ({
  authed: (handler: (ctx: unknown) => Promise<Response>) => async (req: Request, context: { params: Promise<unknown> }) => {
    try {
      return await handler({ req, user: { id: "u1", role: "ADMIN", name: "A" }, params: await context.params });
    } catch (e) {
      const err = e as { status?: number };
      return new Response(null, { status: err.status ?? 500 });
    }
  },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/payments", () => ({ dealPaymentsView: vi.fn(async () => ({})) }));
vi.mock("@/lib/notifications", () => ({ notifyDealStageChange: vi.fn() }));
vi.mock("@/lib/access", async (orig) => ({
  ...(await orig<typeof import("@/lib/access")>()),
  assertLinks: vi.fn(),
  resolveOwner: vi.fn(async () => undefined),
}));

import { POST as recordPayment } from "@/app/api/deals/[id]/payments/route";
import { PATCH as patchDeal } from "@/app/api/deals/[id]/route";

const params = { params: Promise.resolve({ id: "d1" }) };
const json = (body: unknown) =>
  new Request("http://x.test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  tx.payment.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
});

describe("recording a payment", () => {
  const pay = (amount: number) => recordPayment(json({ amount, paidAt: new Date().toISOString() }), params);

  it("uses the amount read under the lock, not the one read before it", async () => {
    db.deal.findFirst.mockResolvedValue({ id: "d1", amount: 1000, currency: "USD" }); // stale
    tx.deal.findUnique.mockResolvedValue({ id: "d1", amount: 100, currency: "USD", deletedAt: null }); // after the edit
    expect((await pay(900)).status).toBe(422);
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it("still records a payment that fits the current amount", async () => {
    db.deal.findFirst.mockResolvedValue({ id: "d1", amount: 1000, currency: "USD" });
    tx.deal.findUnique.mockResolvedValue({ id: "d1", amount: 1000, currency: "USD", deletedAt: null });
    expect((await pay(900)).status).toBe(201);
    expect(tx.payment.create).toHaveBeenCalledOnce();
  });

  it("refuses a deal that was deleted while waiting for the lock", async () => {
    db.deal.findFirst.mockResolvedValue({ id: "d1", amount: 1000, currency: "USD" });
    tx.deal.findUnique.mockResolvedValue({ id: "d1", amount: 1000, currency: "USD", deletedAt: new Date() });
    expect((await pay(10)).status).toBe(404);
    expect(tx.payment.create).not.toHaveBeenCalled();
  });
});

describe("editing a deal", () => {
  const patch = (body: unknown) => patchDeal(new Request("http://x.test", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), params);

  it("checks the currency under the lock", async () => {
    db.deal.findFirst.mockResolvedValue({ stage: "LEAD" });
    tx.deal.findUnique.mockResolvedValue({ currency: "EUR", deletedAt: null }); // changed by another request
    tx.payment.aggregate.mockResolvedValue({ _sum: { amount: 50 } });
    // Payments exist and the deal is EUR now, so asking for EUR must pass and asking for USD must not.
    tx.deal.update.mockResolvedValue({ stage: "LEAD" });
    expect((await patch({ currency: "USD" })).status).toBe(422);
    expect(tx.deal.update).not.toHaveBeenCalled();
  });

  it("refuses a deal that was deleted while waiting for the lock", async () => {
    db.deal.findFirst.mockResolvedValue({ stage: "LEAD" });
    tx.deal.findUnique.mockResolvedValue({ currency: "USD", deletedAt: new Date() });
    expect((await patch({ amount: 5 })).status).toBe(404);
    expect(tx.deal.update).not.toHaveBeenCalled();
  });
});
