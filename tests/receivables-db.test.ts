import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTwoTenants, testDatabaseUrl, type TwoTenants } from "./helpers/two-tenants";

// The money reports (Phase 4.2) on a real database holding two businesses: each business sees only its own deals, payments
// and salespeople, a sales user sees only their own deals, and the numbers match what was entered. Needs TEST_DATABASE_URL.
// Runs the loaders on the owner connection, so this proves the application filters (row-level security is tested apart).

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_t, key) => (holder.db as Record<string | symbol, unknown>)[key] }),
}));

import { buildReceivables, buildUpcoming, loadReceivableDeals, loadSalespeople } from "@/lib/receivables";

const run = testDatabaseUrl() ? describe : describe.skip;
const NOW = new Date("2026-11-03T10:00:00Z");
const d = (s: string) => new Date(`${s}T00:00:00Z`);

run("money reports across two businesses", () => {
  let t: TwoTenants;
  beforeAll(async () => {
    t = await createTwoTenants();
    holder.db = t.db;
    // Business A: a won USD deal, 300, with 100 paid and a schedule (one instalment 14 days late), owned by A's admin.
    const mk = async (f: TwoTenants["a"], title: string, owner: string, amount: number, currency: string) =>
      t.db.deal.create({ data: { tenantId: f.tenantId, title, amount, currency, stage: "CLOSED_WON", closedAt: d("2026-10-15"), ownerId: owner, contactId: f.contact } });
    const dealA = await mk(t.a, "A owed", t.a.admin, 300, "USD");
    await t.db.instalment.createMany({
      data: [
        { tenantId: t.a.tenantId, dealId: dealA.id, position: 1, dueDate: d("2026-10-01"), amount: 100 },
        { tenantId: t.a.tenantId, dealId: dealA.id, position: 2, dueDate: d("2026-10-20"), amount: 100 },
        { tenantId: t.a.tenantId, dealId: dealA.id, position: 3, dueDate: d("2026-11-10"), amount: 100 },
      ],
    });
    await t.db.payment.create({ data: { tenantId: t.a.tenantId, dealId: dealA.id, amount: 100, paidAt: d("2026-10-02") } });
    // A second deal in A owned by A's salesperson, in EUR, no schedule.
    await mk(t.a, "A sales deal", t.a.sales, 50, "EUR");
    // Business B: a bigger deal that must never show up in A's numbers.
    const dealB = await mk(t.b, "B secret", t.b.admin, 9999, "USD");
    await t.db.payment.create({ data: { tenantId: t.b.tenantId, dealId: dealB.id, amount: 1, paidAt: d("2026-10-02") } });
  }, 120_000);
  afterAll(async () => {
    await t?.dispose();
  });

  it("an admin of A sees A's deals, and none of B's", async () => {
    const { deals } = await loadReceivableDeals({ tenantId: t.a.tenantId });
    const titles = deals.map((x) => x.title);
    expect(titles).toContain("A owed");
    expect(titles).toContain("A sales deal");
    expect(titles).not.toContain("B secret");
  });

  it("works out the same numbers as entered", async () => {
    const { deals } = await loadReceivableDeals({ tenantId: t.a.tenantId });
    // The fixture business also has a deal of its own; the numbers below are for the two this test made.
    const r = buildReceivables(deals.filter((x) => x.title.startsWith("A ")), NOW);
    const owed = r.deals.find((x) => x.title === "A owed")!;
    expect(owed.balance).toBe(200);
    expect(owed.buckets).toMatchObject({ late1to30: 100, current: 100 });
    expect(owed.oldestDaysLate).toBe(14);
    expect(r.totals.USD.balance).toBe(200);
    expect(r.totals.EUR.balance).toBe(50);
    expect(JSON.stringify(r)).not.toContain("B secret");
  });

  it("a sales user sees only their own deals", async () => {
    const { deals } = await loadReceivableDeals({ tenantId: t.a.tenantId, ownerId: t.a.sales });
    const titles = deals.map((x) => x.title);
    expect(titles).toContain("A sales deal");
    expect(titles).not.toContain("A owed"); // owned by A's admin
  });

  it("the upcoming report only has A's instalments", async () => {
    const { deals } = await loadReceivableDeals({ tenantId: t.a.tenantId });
    const u = buildUpcoming(deals, 30, NOW);
    expect(u.items.map((i) => `${i.dueDate} ${i.title}`)).toEqual(["2026-11-10 A owed"]);
    expect(u.totals).toEqual({ USD: 100 });
  });

  it("the salesperson report covers only the caller's business", async () => {
    const people = await loadSalespeople(t.a.tenantId, 12, NOW);
    const ids = people.map((p) => p.userId);
    expect(ids).toContain(t.a.admin);
    expect(ids).not.toContain(t.b.admin);
    const admin = people.find((p) => p.userId === t.a.admin)!;
    expect(admin.won).toBe(1);
    expect(admin.wonValue).toEqual({ USD: 300 });
    expect(admin.collected).toEqual({ USD: 100 });
    expect(JSON.stringify(people)).not.toContain("9999");
  });
});
