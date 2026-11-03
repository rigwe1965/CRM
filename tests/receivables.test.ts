import { describe, expect, it } from "vitest";
import { bucketOf, buildReceivables, buildSalespeople, buildUpcoming, daysLate, sellThrough, type ReceivableDeal } from "@/lib/receivables";

const NOW = new Date("2026-11-03T10:00:00Z");
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const deal = (over: Partial<ReceivableDeal> & { id: string }): ReceivableDeal => ({
  title: over.id,
  currency: "USD",
  amount: 0,
  stage: "NEGOTIATION",
  contact: { id: "c1", name: "Ada Okafor" },
  paid: 0,
  schedule: [],
  ...over,
});
const inst = (id: string, position: number, due: string, amount: number) => ({ id, position, dueDate: d(due), amount });

describe("ageing buckets", () => {
  it("puts the boundaries in the right bucket", () => {
    expect([0, 1, 30, 31, 60, 61].map(bucketOf)).toEqual(["current", "late1to30", "late1to30", "late31to60", "late31to60", "late60plus"]);
  });
  it("counts whole UTC days late, and never negative", () => {
    expect(daysLate(d("2026-11-01"), NOW)).toBe(2);
    expect(daysLate(d("2026-11-03"), NOW)).toBe(0); // due today is not late
    expect(daysLate(d("2026-12-01"), NOW)).toBe(0);
  });
});

describe("buildReceivables", () => {
  const deals = [
    // 300 USD, 100 paid: the first instalment is covered, the second is 14 days late, the third is not due.
    deal({ id: "A", amount: 300, paid: 100, schedule: [inst("a1", 1, "2026-10-01", 100), inst("a2", 2, "2026-10-20", 100), inst("a3", 3, "2026-12-01", 100)] }),
    // Won with no schedule: owed in full, no due date.
    deal({ id: "B", amount: 500, stage: "CLOSED_WON" }),
    // EUR, 94 days late, a different customer.
    deal({ id: "C", currency: "EUR", amount: 50, contact: { id: "c2", name: "Bola Adeyemi" }, schedule: [inst("c1", 1, "2026-08-01", 50)] }),
    deal({ id: "LOST", amount: 900, stage: "CLOSED_LOST", schedule: [inst("l1", 1, "2026-01-01", 900)] }),
    deal({ id: "OPEN-NO-SCHEDULE", amount: 400 }), // not a sale yet and nothing scheduled: not owed
    deal({ id: "PAID", amount: 200, paid: 200, stage: "CLOSED_WON" }),
  ];
  const r = buildReceivables(deals, NOW);

  it("lists only deals that are owed, most overdue first", () => {
    // A has 100 overdue, C 50, B none (it has no due date).
    expect(r.deals.map((x) => x.dealId)).toEqual(["A", "C", "B"]);
  });
  it("splits a deal's balance by how late each unpaid instalment is", () => {
    const a = r.deals.find((x) => x.dealId === "A")!;
    expect(a.balance).toBe(200);
    expect(a.buckets).toEqual({ current: 100, late1to30: 100, late31to60: 0, late60plus: 0, noDueDate: 0 });
    expect(a.overdue).toBe(100);
    expect(a.oldestDaysLate).toBe(14);
    expect(r.deals.find((x) => x.dealId === "C")!.buckets.late60plus).toBe(50);
    expect(r.deals.find((x) => x.dealId === "B")!.buckets.noDueDate).toBe(500);
  });
  it("keeps every total per currency and never adds across them", () => {
    expect(r.totals.USD).toMatchObject({ balance: 700, current: 100, late1to30: 100, noDueDate: 500 });
    expect(r.totals.EUR).toMatchObject({ balance: 50, late60plus: 50 });
    expect(Object.keys(r.totals).sort()).toEqual(["EUR", "USD"]);
  });
  it("gives one customer one row per currency", () => {
    const two = buildReceivables([deal({ id: "X", amount: 10, stage: "CLOSED_WON" }), deal({ id: "Y", amount: 20, currency: "EUR", stage: "CLOSED_WON" })], NOW);
    expect(two.customers.map((c) => [c.customer, c.currency, c.balance]).sort()).toEqual([["Ada Okafor", "EUR", 20], ["Ada Okafor", "USD", 10]]);
  });
  it("puts what a short schedule does not cover under no due date", () => {
    const s = buildReceivables([deal({ id: "S", amount: 300, schedule: [inst("s1", 1, "2026-12-01", 100)] })], NOW);
    expect(s.deals[0].buckets).toMatchObject({ current: 100, noDueDate: 200 });
    expect(s.deals[0].balance).toBe(300);
  });
  it("never reports a negative no-due-date amount when the schedule adds up to more than the deal", () => {
    const s = buildReceivables([deal({ id: "S", amount: 100, schedule: [inst("s1", 1, "2026-12-01", 100), inst("s2", 2, "2027-01-01", 100)] })], NOW);
    expect(s.deals[0].buckets.noDueDate).toBe(0);
  });
  it("is exact to the cent", () => {
    const s = buildReceivables([deal({ id: "S", amount: 0.3, paid: 0.1, stage: "CLOSED_WON" })], NOW);
    expect(s.deals[0].balance).toBe(0.2);
  });
});

describe("buildUpcoming", () => {
  const deals = [
    deal({ id: "A", amount: 300, paid: 100, schedule: [inst("a1", 1, "2026-10-01", 100), inst("a2", 2, "2026-10-20", 100), inst("a3", 3, "2026-11-03", 100)] }),
    deal({ id: "B", amount: 200, schedule: [inst("b1", 1, "2026-11-20", 100), inst("b2", 2, "2026-12-31", 100)] }),
    deal({ id: "E", currency: "EUR", amount: 50, schedule: [inst("e1", 1, "2026-11-10", 50)] }),
  ];
  const r = buildUpcoming(deals, 30, NOW);
  it("lists unpaid instalments due from today up to the limit, in date order", () => {
    // a2 is overdue (the ageing report has it); b2 is 58 days away.
    expect(r.items.map((i) => `${i.dueDate} ${i.title}`)).toEqual(["2026-11-03 A", "2026-11-10 E", "2026-11-20 B"]);
  });
  it("totals per currency", () => {
    expect(r.totals).toEqual({ USD: 200, EUR: 50 });
  });
  it("a longer window picks up more", () => {
    expect(buildUpcoming(deals, 90, NOW).items).toHaveLength(4);
  });
});

describe("sellThrough", () => {
  const rows = sellThrough([
    { key: "a", product: "Bundles", description: "", color: "1B", lengthInches: 18, bought: 10, sold: 4, onHand: 6 },
    { key: "b", product: "Closure", description: "", color: "1B", lengthInches: 16, bought: 0, sold: 4, onHand: -4 },
    { key: "c", product: "Frontal", description: "", color: "613", lengthInches: 20, bought: 3, sold: 3, onHand: 0, low: true },
  ]);
  it("ranks by pieces sold, then by share sold", () => {
    // a and b both sold 4; a has a share sold (40%), b has none to show, so a comes first.
    expect(rows.map((r) => r.key)).toEqual(["a", "b", "c"]);
  });
  it("works out the share sold, and says nothing when nothing was bought", () => {
    expect(rows.find((r) => r.key === "a")!.sellThrough).toBe(40);
    expect(rows.find((r) => r.key === "c")!.sellThrough).toBe(100);
    expect(rows.find((r) => r.key === "b")!.sellThrough).toBeNull();
    expect(rows.find((r) => r.key === "c")!.low).toBe(true);
  });
});

describe("buildSalespeople", () => {
  const people = [{ id: "u1", name: "Sam" }, { id: "u2", name: "Alex" }, { id: "u3", name: "Idle" }];
  const rows = buildSalespeople(
    people,
    [
      { ownerId: "u1", stage: "CLOSED_WON", currency: "USD", count: 2, amount: 500 },
      { ownerId: "u1", stage: "CLOSED_WON", currency: "EUR", count: 1, amount: 100 },
      { ownerId: "u1", stage: "CLOSED_LOST", currency: "USD", count: 3, amount: 900 },
      { ownerId: "u2", stage: "CLOSED_LOST", currency: "USD", count: 1, amount: 50 },
    ],
    [{ ownerId: "u2", stage: "NEGOTIATION", currency: "USD", count: 2, amount: 250 }],
    [{ ownerId: "u1", currency: "USD", amount: 300 }],
  );
  it("counts won and lost and works out conversion", () => {
    const sam = rows.find((r) => r.userId === "u1")!;
    expect([sam.won, sam.lost, sam.conversion]).toEqual([3, 3, 50]);
    expect(rows.find((r) => r.userId === "u2")!.conversion).toBe(0);
  });
  it("keeps money per currency", () => {
    const sam = rows.find((r) => r.userId === "u1")!;
    expect(sam.wonValue).toEqual({ USD: 500, EUR: 100 });
    expect(sam.collected).toEqual({ USD: 300 });
    expect(rows.find((r) => r.userId === "u2")!.openValue).toEqual({ USD: 250 });
  });
  it("leaves out someone with nothing to show, and ignores owners it does not know", () => {
    expect(rows.map((r) => r.userId).sort()).toEqual(["u1", "u2"]);
    expect(buildSalespeople(people, [{ ownerId: "ghost", stage: "CLOSED_WON", currency: "USD", count: 1, amount: 1 }], [], [])).toEqual([]);
  });
});
