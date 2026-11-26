import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creditLeftMicros, grantCredit, GRANT_HARD_LIMIT_USD, GRANT_SOFT_LIMIT_USD } from "../scripts/tenant-admin-lib";

// The owner's `grant-credit` and `credit` commands, with the database faked: what is written, what is refused.

const M = 1_000_000;
const db = {
  tenant: { findUnique: vi.fn() },
  aiCredit: { create: vi.fn(), aggregate: vi.fn() },
  aiUsage: { aggregate: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(),
};
const client = db as unknown as PrismaClient;
const now = new Date("2026-11-16T10:00:00Z");

beforeEach(() => {
  vi.resetAllMocks();
  db.tenant.findUnique.mockResolvedValue({ id: "t1", name: "Shop", status: "ACTIVE" });
  db.aiCredit.create.mockImplementation((a) => Promise.resolve(a));
  db.auditLog.create.mockImplementation((a) => Promise.resolve(a));
  db.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
  db.aiCredit.aggregate.mockResolvedValue({ _sum: { amountMicros: 5 * M } });
  db.aiUsage.aggregate.mockResolvedValue({ _sum: { creditMicros: 2 * M } });
});

describe("creditLeftMicros", () => {
  it("is everything credited less what usage took from credit", async () => expect(await creditLeftMicros(client, "t1")).toBe(3 * M));
  it("never goes below zero", async () => {
    db.aiUsage.aggregate.mockResolvedValue({ _sum: { creditMicros: 9 * M } });
    expect(await creditLeftMicros(client, "t1")).toBe(0);
  });
  it("is zero for a business with no credit and no usage", async () => {
    db.aiCredit.aggregate.mockResolvedValue({ _sum: { amountMicros: null } });
    db.aiUsage.aggregate.mockResolvedValue({ _sum: { creditMicros: null } });
    expect(await creditLeftMicros(client, "t1")).toBe(0);
  });
  it("counts only calls that ran on the platform's key", async () => {
    await creditLeftMicros(client, "t1");
    expect(db.aiUsage.aggregate.mock.calls[0][0].where).toEqual({ tenantId: "t1", platformKey: true });
  });
});

describe("grantCredit", () => {
  it("adds the amount to the ledger as a GRANT with a unique reference, and records it in the audit log, together", async () => {
    const r = await grantCredit(client, "t1", 5, { note: " pilot, month 1 " }, now);
    expect(r).toEqual({ name: "Shop", amountMicros: 5 * M, leftMicros: 3 * M });
    const credit = db.aiCredit.create.mock.calls[0][0].data;
    expect(credit).toMatchObject({ tenantId: "t1", amountMicros: 5 * M, source: "GRANT", note: "pilot, month 1" });
    expect(credit.reference).toMatch(/^grant-2026-11-16T10:00:00\.000Z-[0-9a-f]{6}$/);
    const audit = db.auditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({ tenantId: "t1", actorEmail: "tenant-admin", action: "ai.credit_granted_by_operator", summary: "$5.00 AI credit: pilot, month 1" });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
  it("gives two grants in the same instant different references", async () => {
    await grantCredit(client, "t1", 1, {}, now);
    await grantCredit(client, "t1", 1, {}, now);
    const [a, b] = db.aiCredit.create.mock.calls.map((c) => c[0].data.reference);
    expect(a).not.toBe(b);
  });
  it("rounds cents correctly and keeps no note when none is given", async () => {
    await grantCredit(client, "t1", 12.34, {}, now);
    expect(db.aiCredit.create.mock.calls[0][0].data).toMatchObject({ amountMicros: 12_340_000, note: null });
  });
  it("refuses amounts that are not at least one cent", async () => {
    for (const bad of [0, -5, 0.001, NaN, Infinity]) await expect(grantCredit(client, "t1", bad, {}, now)).rejects.toThrow("at least $0.01");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("refuses a big grant unless --force, and refuses anything over the hard limit even then", async () => {
    await expect(grantCredit(client, "t1", GRANT_SOFT_LIMIT_USD + 1, {}, now)).rejects.toThrow("--force");
    await expect(grantCredit(client, "t1", GRANT_SOFT_LIMIT_USD + 1, { force: true }, now)).resolves.toBeDefined();
    await expect(grantCredit(client, "t1", GRANT_HARD_LIMIT_USD + 1, { force: true }, now)).rejects.toThrow("most one grant");
  });
  it("keeps the biggest grant inside the 32-bit column", () => expect(GRANT_HARD_LIMIT_USD * M).toBeLessThan(2_147_483_647));
  it("refuses an unknown business and one that has not confirmed its email", async () => {
    db.tenant.findUnique.mockResolvedValueOnce(null);
    await expect(grantCredit(client, "nope", 5, {}, now)).rejects.toThrow("No business");
    db.tenant.findUnique.mockResolvedValueOnce({ id: "t2", name: "New", status: "PENDING" });
    await expect(grantCredit(client, "t2", 5, {}, now)).rejects.toThrow("not confirmed");
    expect(db.aiCredit.create).not.toHaveBeenCalled();
  });
  it("trims a very long note to 200 characters", async () => {
    await grantCredit(client, "t1", 1, { note: "x".repeat(500) }, now);
    expect(db.aiCredit.create.mock.calls[0][0].data.note).toHaveLength(200);
  });
});
