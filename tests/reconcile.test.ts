import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, authedRoles } = vi.hoisted(() => ({ db: { deal: { findMany: vi.fn() } }, authedRoles: [] as unknown[][] }));
vi.mock("@/lib/db", () => ({ db }));
// Skip auth and rate limiting; remember which roles each route asked for.
vi.mock("@/lib/route", () => ({
  authed:
    (handler: (ctx: unknown) => Promise<Response>, ...roles: unknown[]) => {
      authedRoles.push(roles);
      return async () => handler({ user: { id: "u1", role: "ADMIN", tenantId: "t1" } });
    },
}));

import { reconcileDeal, reconcileTenant, type DealForCheck } from "@/lib/reconcile";
import { summarize } from "@/lib/payments";
import { GET } from "@/app/api/reports/reconcile/route";

const NOW = new Date("2026-10-30T00:00:00Z");
const deal = (over: Partial<DealForCheck> = {}): DealForCheck => ({
  id: "d1",
  title: "Adaeze order",
  amount: 200,
  currency: "USD",
  stage: "NEGOTIATION",
  payments: [],
  instalments: [],
  items: [],
  paymentLinks: [],
  ...over,
});
const kinds = (d: DealForCheck) => reconcileDeal(d, NOW).map((f) => f.kind);

describe("reconcileDeal", () => {
  it("finds nothing on a clean deal", () => {
    expect(
      kinds(
        deal({
          payments: [{ amount: 100, source: "MANUAL", providerRef: null }, { amount: 100, source: "ONLINE", providerRef: "pi_1" }],
          instalments: [{ amount: 100 }, { amount: 100 }],
          items: [{ quantity: 2, unitPrice: 100 }],
          paymentLinks: [{ amount: 100, currency: "USD", status: "PAID", createdAt: NOW, hasPayment: true }],
        }),
      ),
    ).toEqual([]);
  });

  it("flags overpayment, but not an exact payoff", () => {
    expect(kinds(deal({ payments: [{ amount: 200.01, source: "MANUAL", providerRef: null }] }))).toEqual(["OVERPAID"]);
    expect(kinds(deal({ payments: [{ amount: 200, source: "MANUAL", providerRef: null }] }))).toEqual([]);
  });

  it("flags an instalment schedule that doesn't add up to the deal, and ignores deals with no schedule", () => {
    expect(kinds(deal({ instalments: [{ amount: 100 }, { amount: 99.99 }] }))).toEqual(["SCHEDULE_MISMATCH"]);
    expect(kinds(deal({ instalments: [] }))).toEqual([]);
  });

  it("compares in cents, so float noise is not a mismatch", () => {
    expect(kinds(deal({ amount: 0.3, instalments: [{ amount: 0.1 }, { amount: 0.2 }] }))).toEqual([]);
  });

  it("flags line items that don't add up to the deal", () => {
    expect(kinds(deal({ items: [{ quantity: 1, unitPrice: 150 }] }))).toEqual(["ITEMS_MISMATCH"]);
  });

  it("flags online payments with no Stripe reference", () => {
    expect(kinds(deal({ payments: [{ amount: 50, source: "ONLINE", providerRef: null }] }))).toEqual(["ORPHAN_ONLINE_PAYMENT"]);
    expect(kinds(deal({ payments: [{ amount: 50, source: "MANUAL", providerRef: null }] }))).toEqual([]);
  });

  it("flags a paid link with no payment, and a link that needs a refund", () => {
    const link = (status: string, hasPayment: boolean) => ({ amount: 50, currency: "USD", status, createdAt: NOW, hasPayment });
    expect(kinds(deal({ paymentLinks: [link("PAID", false)] }))).toEqual(["PAID_LINK_WITHOUT_PAYMENT"]);
    expect(kinds(deal({ paymentLinks: [link("REFUND_NEEDED", false)] }))).toEqual(["REFUND_NEEDED"]);
    expect(kinds(deal({ paymentLinks: [link("CANCELLED", false)] }))).toEqual([]);
  });

  it("flags a pending link only after 14 days", () => {
    const link = (daysOld: number) => ({ amount: 50, currency: "USD", status: "PENDING", createdAt: new Date(NOW.getTime() - daysOld * 86_400_000), hasPayment: false });
    expect(kinds(deal({ paymentLinks: [link(13)] }))).toEqual([]);
    expect(kinds(deal({ paymentLinks: [link(15)] }))).toEqual(["STALE_PENDING_LINK"]);
  });

  it("flags a payment link in another currency than its deal", () => {
    expect(kinds(deal({ paymentLinks: [{ amount: 50, currency: "EUR", status: "PAID", createdAt: NOW, hasPayment: true }] }))).toEqual(["CURRENCY_DRIFT"]);
  });

  it("flags a won deal that still owes money and has no schedule", () => {
    expect(kinds(deal({ stage: "CLOSED_WON", payments: [{ amount: 50, source: "MANUAL", providerRef: null }] }))).toEqual(["UNSCHEDULED_BALANCE"]);
    expect(kinds(deal({ stage: "CLOSED_WON", payments: [{ amount: 200, source: "MANUAL", providerRef: null }] }))).toEqual([]);
    expect(kinds(deal({ stage: "CLOSED_WON", instalments: [{ amount: 200 }] }))).toEqual([]);
    expect(kinds(deal({ stage: "NEGOTIATION" }))).toEqual([]);
  });

  it("keeps each finding in its own currency and never adds across currencies", () => {
    const f = reconcileDeal(deal({ currency: "EUR", payments: [{ amount: 300, source: "MANUAL", providerRef: null }] }), NOW);
    expect(f[0]).toMatchObject({ currency: "EUR", severity: "high" });
    expect(f[0].detail).toContain("EUR");
    expect(f[0].detail).not.toContain("USD");
  });
});

describe("what to do", () => {
  const ALL_KINDS = [
    "OVERPAID",
    "SCHEDULE_MISMATCH",
    "ITEMS_MISMATCH",
    "ORPHAN_ONLINE_PAYMENT",
    "PAID_LINK_WITHOUT_PAYMENT",
    "REFUND_NEEDED",
    "STALE_PENDING_LINK",
    "UNSCHEDULED_BALANCE",
    "CURRENCY_DRIFT",
  ] as const;

  // One deal that trips every check, so each kind is produced by the real code.
  const everything = deal({
    stage: "CLOSED_WON",
    amount: 200,
    payments: [{ amount: 250, source: "ONLINE", providerRef: null }],
    instalments: [{ amount: 100 }],
    items: [{ quantity: 1, unitPrice: 150 }],
    paymentLinks: [
      { amount: 50, currency: "USD", status: "PAID", createdAt: NOW, hasPayment: false },
      { amount: 50, currency: "USD", status: "REFUND_NEEDED", createdAt: NOW, hasPayment: false },
      { amount: 50, currency: "USD", status: "PENDING", createdAt: new Date(NOW.getTime() - 20 * 86_400_000), hasPayment: false },
      { amount: 50, currency: "EUR", status: "CANCELLED", createdAt: NOW, hasPayment: false },
    ],
  });

  it("gives every kind of finding a plain-words action", () => {
    // Without payments or a schedule the same deal is a won deal that is owed money and has no reminders.
    const unscheduled = reconcileDeal({ ...everything, payments: [], instalments: [] }, NOW);
    const all = [...reconcileDeal(everything, NOW), ...unscheduled];
    expect(new Set(all.map((f) => f.kind))).toEqual(new Set(ALL_KINDS));
    for (const f of all) expect(f.fix.length).toBeGreaterThan(20);
  });

  it("keeps advice out of `detail`, which only says what is wrong", () => {
    const advice = /\b(refund|cancel|edit|delete|check|confirm|choose|should|must)\b/i;
    for (const f of reconcileDeal(everything, NOW)) expect(f.detail, f.kind).not.toMatch(advice);
  });
});

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `Deal ${id}`,
  amount: "200",
  currency: "USD",
  stage: "NEGOTIATION",
  payments: [],
  instalments: [],
  items: [],
  paymentLinks: [],
  ...over,
});

describe("reconcileTenant", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads only live deals in the given scope", async () => {
    db.deal.findMany.mockResolvedValue([]);
    await reconcileTenant({ tenantId: "t1", ownerId: "u9" });
    expect(db.deal.findMany.mock.calls[0][0].where).toEqual({ tenantId: "t1", ownerId: "u9", deletedAt: null });
  });

  it("lists serious findings first and caps the list", async () => {
    db.deal.findMany.mockResolvedValue([
      row("a", { stage: "CLOSED_WON" }), // low: owed, no schedule
      row("b", { payments: [{ amount: "250", source: "MANUAL", providerRef: null }] }), // high: overpaid
      row("c", { stage: "CLOSED_WON" }), // low
    ]);
    const r = await reconcileTenant({ tenantId: "t1" }, 2);
    expect(r.checked).toBe(3);
    expect(r.findings.map((f) => f.dealId)).toEqual(["b", "a"]);
    expect(r.truncated).toBe(true);
    expect(r.counts).toEqual({ OVERPAID: 1, UNSCHEDULED_BALANCE: 2 });
  });

  it("pages through large businesses", async () => {
    const page = Array.from({ length: 500 }, (_, i) => row(`d${i}`));
    db.deal.findMany.mockResolvedValueOnce(page).mockResolvedValueOnce([row("last")]);
    const r = await reconcileTenant({ tenantId: "t1" });
    expect(r.checked).toBe(501);
    expect(db.deal.findMany.mock.calls[1][0]).toMatchObject({ skip: 1, cursor: { id: "d499" } });
  });
});

describe("/api/reports/reconcile", () => {
  it("is admin-only and scoped to the caller's business", async () => {
    expect(authedRoles.at(-1)).toEqual(["ADMIN"]);
    db.deal.findMany.mockResolvedValue([]);
    const res = await (GET as unknown as () => Promise<Response>)();
    expect(db.deal.findMany.mock.calls.at(-1)?.[0].where).toEqual({ tenantId: "t1", deletedAt: null });
    expect(await res.json()).toEqual({ data: { checked: 0, findings: [], truncated: false, counts: {} } });
  });
});

describe("summarize edge cases", () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  const schedule = [{ id: "a", position: 1, dueDate: d("2026-01-01"), amount: 100 }, { id: "b", position: 2, dueDate: d("2026-02-01"), amount: 100 }];

  it("a part payment leaves the first instalment partly covered and the balance exact", () => {
    const { summary, instalments } = summarize(200, 40.5, schedule, "2026-01-02");
    expect(instalments[0].covered).toBe(40.5);
    expect(summary).toMatchObject({ paid: 40.5, balance: 159.5, overdue: true });
    expect(summary.nextDue?.amount).toBe(59.5);
  });

  it("an overpayment gives a negative balance and no next due date", () => {
    const { summary } = summarize(200, 250, schedule, "2026-03-01");
    expect(summary).toMatchObject({ paid: 250, balance: -50, nextDue: null, overdue: false });
  });

  it("paying exactly the first instalment on its due date is on time", () => {
    const { summary } = summarize(200, 100, schedule, "2026-01-01");
    expect(summary.overdue).toBe(false);
    expect(summary.nextDue?.dueDate).toEqual(d("2026-02-01"));
  });

  it("cent-level payments don't drift through float rounding", () => {
    const { summary } = summarize(0.3, 0.1 + 0.2, [{ id: "a", position: 1, dueDate: d("2026-01-01"), amount: 0.3 }], "2026-02-01");
    expect(summary.balance).toBe(0); // toBe uses Object.is, so this also rejects -0
    expect(summary.overdue).toBe(false);
  });
});
