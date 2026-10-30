import { beforeEach, describe, expect, it, vi } from "vitest";

const { tx, db, audit } = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    instalment: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    payment: { aggregate: vi.fn() },
  };
  const db = { deal: { findFirst: vi.fn() }, $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  return { tx, db, audit: vi.fn() };
});
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/audit", () => ({ audit }));
vi.mock("@/lib/payments", () => ({ dealPaymentsView: vi.fn(async () => ({ ok: true })) }));

import { replaceSchedule, scheduleKey } from "@/lib/replace-schedule";

const user = { id: "u1", tenantId: "t1", role: "SALES", name: "Sam" } as never;
const two = [{ dueDate: new Date("2026-12-01"), amount: 600 }, { dueDate: new Date("2027-01-01"), amount: 600 }];
const existing = [{ id: "i1", position: 1, dueDate: new Date("2026-11-01"), amount: "1200" }];

beforeEach(() => {
  vi.clearAllMocks();
  db.deal.findFirst.mockResolvedValue({ id: "d1", amount: "1200", currency: "USD" });
  tx.instalment.findMany.mockResolvedValue(existing);
  tx.payment.aggregate.mockResolvedValue({ _sum: { amount: "300" } });
});

describe("scheduleKey", () => {
  it("is the same for the same schedule in any order, and different when anything changes", () => {
    expect(scheduleKey([])).toBe("");
    const a = scheduleKey([{ dueDate: new Date("2026-12-01"), amount: 600 }, { dueDate: new Date("2026-11-01"), amount: "600" }]);
    expect(a).toBe("2026-11-01:600.00|2026-12-01:600.00");
    expect(scheduleKey([{ dueDate: new Date("2026-11-01"), amount: 600 }, { dueDate: new Date("2026-12-01"), amount: 600.01 }])).not.toBe(a);
  });
});

describe("replaceSchedule", () => {
  it("replaces the schedule under the deal's row lock, scoped to the caller, and audits the before and after", async () => {
    await replaceSchedule(user, "d1", two, { req: new Request("http://x.test") });
    expect(db.deal.findFirst.mock.calls[0][0].where).toMatchObject({ id: "d1", deletedAt: null, tenantId: "t1", ownerId: "u1" });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.instalment.deleteMany.mock.calls[0][0].where).toMatchObject({ dealId: "d1", tenantId: "t1" });
    expect(tx.instalment.createMany.mock.calls[0][0].data).toEqual([
      { tenantId: "t1", dealId: "d1", position: 1, dueDate: two[0].dueDate, amount: 600 },
      { tenantId: "t1", dealId: "d1", position: 2, dueDate: two[1].dueDate, amount: 600 },
    ]);
    expect(audit.mock.calls[0][1]).toMatchObject({ action: "schedule.replaced", entity: "deal", entityId: "d1", data: { before: existing, after: two } });
  });

  it("refuses a total above the deal amount without touching anything", async () => {
    await expect(replaceSchedule(user, "d1", [{ dueDate: new Date("2026-12-01"), amount: 1300 }])).rejects.toMatchObject({ status: 422 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("clears the schedule when given an empty list", async () => {
    await replaceSchedule(user, "d1", []);
    expect(tx.instalment.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.instalment.createMany.mock.calls[0][0].data).toEqual([]);
  });

  it("404s for a deal the caller cannot see", async () => {
    db.deal.findFirst.mockResolvedValue(null);
    await expect(replaceSchedule(user, "d1", two)).rejects.toMatchObject({ status: 404 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("goes ahead when the payments and schedule are what the card expected", async () => {
    await replaceSchedule(user, "d1", two, { expect: { paid: 300, scheduleKey: scheduleKey(existing) } });
    expect(tx.instalment.createMany).toHaveBeenCalledTimes(1);
  });

  it("changes nothing, and says why, if more was paid since the card was made", async () => {
    await expect(replaceSchedule(user, "d1", two, { expect: { paid: 100, scheduleKey: scheduleKey(existing) } })).rejects.toMatchObject({ status: 409, code: "AI_PROPOSAL_STALE" });
    expect(tx.instalment.deleteMany).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("changes nothing if someone edited the schedule since the card was made", async () => {
    await expect(replaceSchedule(user, "d1", two, { expect: { paid: 300, scheduleKey: "" } })).rejects.toMatchObject({ status: 409, code: "AI_PROPOSAL_STALE" });
    expect(tx.instalment.deleteMany).not.toHaveBeenCalled();
  });

  it("does not check any expectation for an ordinary screen change", async () => {
    tx.payment.aggregate.mockResolvedValue({ _sum: { amount: "999" } });
    await replaceSchedule(user, "d1", two);
    expect(tx.payment.aggregate).not.toHaveBeenCalled();
    expect(tx.instalment.createMany).toHaveBeenCalledTimes(1);
  });
});
