import { beforeEach, describe, expect, it, vi } from "vitest";

const { tx, db, audit } = vi.hoisted(() => {
  const tx = { $queryRaw: vi.fn(), deal: { findFirst: vi.fn() }, payment: { aggregate: vi.fn(), create: vi.fn() } };
  const db = { deal: { findFirst: vi.fn() }, $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  return { tx, db, audit: vi.fn() };
});
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/audit", () => ({ audit }));
vi.mock("@/lib/payments", () => ({ dealPaymentsView: vi.fn(async () => ({ ok: true })) }));

import { recordPayment } from "@/lib/record-payment";

const user = { id: "u1", tenantId: "t1", role: "SALES", name: "Sam" } as never;
const body = { amount: 400, paidAt: new Date("2026-10-30"), method: "BANK_TRANSFER" as const };

beforeEach(() => {
  vi.clearAllMocks();
  db.deal.findFirst.mockResolvedValue({ id: "d1", amount: "1200", currency: "USD" });
  tx.deal.findFirst.mockResolvedValue({ id: "d1", amount: "1200", currency: "USD", deletedAt: null });
  tx.payment.aggregate.mockResolvedValue({ _sum: { amount: "400" } });
});

describe("recordPayment", () => {
  it("records the payment under the deal's row lock, scoped to the caller, and audits it", async () => {
    await recordPayment(user, "d1", body, { req: new Request("http://x.test") });
    expect(db.deal.findFirst.mock.calls[0][0].where).toMatchObject({ id: "d1", deletedAt: null, tenantId: "t1", ownerId: "u1" });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.payment.create.mock.calls[0][0].data).toMatchObject({ amount: 400, dealId: "d1", tenantId: "t1", recordedById: "u1" });
    expect(audit.mock.calls[0][1]).toMatchObject({ action: "payment.recorded", entity: "deal", entityId: "d1", summary: "400 USD" });
  });

  it("refuses an amount above the balance, as before", async () => {
    await expect(recordPayment(user, "d1", { ...body, amount: 800.01 })).rejects.toMatchObject({ status: 422 });
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it("records nothing, and says why, when the deal was paid more since the card was made (expectPaid)", async () => {
    tx.payment.aggregate.mockResolvedValue({ _sum: { amount: "600" } });
    await expect(recordPayment(user, "d1", body, { expectPaid: 400 })).rejects.toMatchObject({ status: 409, code: "AI_PROPOSAL_STALE" });
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("goes ahead when what was paid is exactly what the card expected", async () => {
    await recordPayment(user, "d1", body, { expectPaid: 400 });
    expect(tx.payment.create).toHaveBeenCalledTimes(1);
  });

  it("does not check the expectation for an ordinary screen payment", async () => {
    tx.payment.aggregate.mockResolvedValue({ _sum: { amount: "600" } });
    await recordPayment(user, "d1", body);
    expect(tx.payment.create).toHaveBeenCalledTimes(1);
  });

  it("404s for a deal the caller cannot see, without taking a lock", async () => {
    db.deal.findFirst.mockResolvedValue(null);
    await expect(recordPayment(user, "d1", body)).rejects.toMatchObject({ status: 404 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
