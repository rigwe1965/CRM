import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { OwnerScope } from "@/lib/access";
import { addMoney, round2, type MoneyMap } from "@/lib/money";
import { summarize } from "@/lib/payments";

/**
 * Money owed to the business, and money coming in (NEXT_LEVEL_PLAN.md Phase 4.2).
 *
 * Money is kept per currency and never added across currencies. A deal counts as owed when it is live, not lost, and either
 * has an instalment schedule or has been won (a won deal with no schedule is owed in full, with no due date). Payments are
 * applied to the schedule oldest-first, exactly as the deal's own Payments screen does (`summarize`).
 */

export const BUCKETS = ["current", "late1to30", "late31to60", "late60plus", "noDueDate"] as const;
export type Bucket = (typeof BUCKETS)[number];
export const BUCKET_LABELS: Record<Bucket, string> = {
  current: "Not yet due",
  late1to30: "1-30 days late",
  late31to60: "31-60 days late",
  late60plus: "More than 60 days late",
  noDueDate: "No due date",
};

const DAY = 86_400_000;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const dayNumber = (key: string) => Math.floor(Date.parse(`${key}T00:00:00Z`) / DAY);

/** Whole days an instalment is late (0 when due today or later). Both dates are UTC calendar days. */
export const daysLate = (due: Date, today: Date) => Math.max(0, dayNumber(dayKey(today)) - dayNumber(dayKey(due)));

export const bucketOf = (late: number): Bucket => (late <= 0 ? "current" : late <= 30 ? "late1to30" : late <= 60 ? "late31to60" : "late60plus");

export type ReceivableDeal = {
  id: string;
  title: string;
  currency: string;
  amount: number;
  stage: string;
  contact: { id: string; name: string } | null;
  paid: number;
  schedule: { id: string; position: number; dueDate: Date; amount: number }[];
};

const emptyBuckets = (): Record<Bucket, number> => ({ current: 0, late1to30: 0, late31to60: 0, late60plus: 0, noDueDate: 0 });

export type DealReceivable = {
  dealId: string;
  title: string;
  customerId: string | null;
  customer: string;
  currency: string;
  total: number;
  paid: number;
  balance: number;
  overdue: number;
  oldestDaysLate: number;
  buckets: Record<Bucket, number>;
};

const owed = (d: ReceivableDeal) => d.stage !== "CLOSED_LOST" && (d.schedule.length > 0 || d.stage === "CLOSED_WON");

/** What each deal still owes, split by how late it is, plus totals per currency and per customer (a customer with two currencies gets two rows). */
export function buildReceivables(deals: ReceivableDeal[], now = new Date()) {
  const today = dayKey(now);
  const rows: DealReceivable[] = [];
  for (const d of deals) {
    if (!owed(d)) continue;
    const balance = round2(d.amount - d.paid);
    if (balance <= 0) continue;
    const { instalments } = summarize(d.amount, d.paid, d.schedule, today);
    const buckets = emptyBuckets();
    let scheduled = 0;
    let oldest = 0;
    for (const i of instalments) {
      const left = round2(i.amount - i.covered);
      if (left <= 0) continue;
      const late = daysLate(i.dueDate, now);
      buckets[bucketOf(late)] = round2(buckets[bucketOf(late)] + left);
      scheduled = round2(scheduled + left);
      oldest = Math.max(oldest, late);
    }
    // Whatever the schedule does not account for (no schedule at all, or one that adds up to less than the deal).
    const unscheduled = round2(balance - scheduled);
    if (unscheduled > 0) buckets.noDueDate = round2(buckets.noDueDate + unscheduled);
    const overdue = round2(buckets.late1to30 + buckets.late31to60 + buckets.late60plus);
    rows.push({
      dealId: d.id,
      title: d.title,
      customerId: d.contact?.id ?? null,
      customer: d.contact?.name ?? "No customer",
      currency: d.currency,
      total: round2(d.amount),
      paid: round2(d.paid),
      balance,
      overdue,
      oldestDaysLate: oldest,
      buckets,
    });
  }
  rows.sort((a, b) => b.overdue - a.overdue || b.oldestDaysLate - a.oldestDaysLate || b.balance - a.balance || a.title.localeCompare(b.title));

  const totals: Record<string, Record<Bucket, number> & { balance: number }> = {};
  const byCustomer = new Map<string, { customerId: string | null; customer: string; currency: string; balance: number; overdue: number; deals: number; oldestDaysLate: number }>();
  for (const r of rows) {
    const t = (totals[r.currency] ??= { ...emptyBuckets(), balance: 0 });
    for (const b of BUCKETS) t[b] = round2(t[b] + r.buckets[b]);
    t.balance = round2(t.balance + r.balance);
    const key = `${r.customerId ?? "none"}|${r.currency}`;
    const c = byCustomer.get(key) ?? { customerId: r.customerId, customer: r.customer, currency: r.currency, balance: 0, overdue: 0, deals: 0, oldestDaysLate: 0 };
    c.balance = round2(c.balance + r.balance);
    c.overdue = round2(c.overdue + r.overdue);
    c.deals++;
    c.oldestDaysLate = Math.max(c.oldestDaysLate, r.oldestDaysLate);
    byCustomer.set(key, c);
  }
  const customers = [...byCustomer.values()].sort((a, b) => b.overdue - a.overdue || b.balance - a.balance || a.customer.localeCompare(b.customer));
  return { asOf: today, totals, customers, deals: rows };
}

/** Instalments still to be paid that fall due from today up to `days` days ahead (overdue ones are in the ageing report). */
export function buildUpcoming(deals: ReceivableDeal[], days: number, now = new Date()) {
  const today = dayKey(now);
  const last = dayNumber(today) + days;
  const items: { dealId: string; title: string; customer: string; currency: string; dueDate: string; amount: number }[] = [];
  const totals: MoneyMap = {};
  for (const d of deals) {
    if (!owed(d) || round2(d.amount - d.paid) <= 0) continue;
    for (const i of summarize(d.amount, d.paid, d.schedule, today).instalments) {
      const left = round2(i.amount - i.covered);
      const due = dayNumber(dayKey(i.dueDate));
      if (left <= 0 || due < dayNumber(today) || due > last) continue;
      items.push({ dealId: d.id, title: d.title, customer: d.contact?.name ?? "No customer", currency: d.currency, dueDate: dayKey(i.dueDate), amount: left });
      addMoney(totals, d.currency, left);
    }
  }
  items.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title));
  return { asOf: today, days, totals, items };
}

/** Most deals a receivables report reads; beyond it the report says it was cut short rather than silently dropping rows. */
export const RECEIVABLES_LIMIT = 5000;

/** The deals a receivables or upcoming report works from, for the caller's scope (`owned` is the usual ownerScope). */
export async function loadReceivableDeals(owned: OwnerScope) {
  const deals = await db.deal.findMany({
    where: { ...owned, deletedAt: null, stage: { not: "CLOSED_LOST" }, amount: { gt: 0 }, OR: [{ stage: "CLOSED_WON" }, { instalments: { some: {} } }] },
    select: { id: true, title: true, currency: true, amount: true, stage: true, contact: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: "desc" },
    take: RECEIVABLES_LIMIT + 1,
  });
  const truncated = deals.length > RECEIVABLES_LIMIT;
  const kept = deals.slice(0, RECEIVABLES_LIMIT);
  const ids = kept.map((d) => d.id);
  const [sums, schedule] = ids.length
    ? await Promise.all([
        db.payment.groupBy({ by: ["dealId"], where: { tenantId: owned.tenantId, dealId: { in: ids } }, _sum: { amount: true } }),
        db.instalment.findMany({ where: { tenantId: owned.tenantId, dealId: { in: ids } }, select: { id: true, dealId: true, position: true, dueDate: true, amount: true } }),
      ])
    : [[], []];
  const paid = new Map(sums.map((s) => [s.dealId, Number(s._sum.amount ?? 0)]));
  const byDeal = new Map<string, ReceivableDeal["schedule"]>();
  for (const i of schedule) byDeal.set(i.dealId, [...(byDeal.get(i.dealId) ?? []), { id: i.id, position: i.position, dueDate: i.dueDate, amount: Number(i.amount) }]);
  const result: ReceivableDeal[] = kept.map((d) => ({
    id: d.id,
    title: d.title,
    currency: d.currency,
    amount: Number(d.amount),
    stage: d.stage,
    contact: d.contact ? { id: d.contact.id, name: `${d.contact.firstName} ${d.contact.lastName}`.trim() } : null,
    paid: paid.get(d.id) ?? 0,
    schedule: byDeal.get(d.id) ?? [],
  }));
  return { deals: result, truncated };
}

// ─── Stock sell-through ────────────────────────────────────────────────────

export type SellThroughRow = {
  key: string;
  product: string;
  description: string;
  color: string;
  lengthInches: number | null;
  bought: number;
  sold: number;
  onHand: number;
  /** Pieces sold as a share of pieces bought, in percent to one decimal; null when nothing was bought. */
  sellThrough: number | null;
  low: boolean;
};

/** Stock rows ranked by what sells: most pieces sold first. */
export function sellThrough(rows: { key: string; product: string; description: string; color: string; lengthInches: number | null; bought: number; sold: number; onHand: number; low?: boolean }[]): SellThroughRow[] {
  return rows
    .map((r) => ({
      key: r.key,
      product: r.product,
      description: r.description,
      color: r.color,
      lengthInches: r.lengthInches,
      bought: r.bought,
      sold: r.sold,
      onHand: r.onHand,
      sellThrough: r.bought > 0 ? Math.round((r.sold / r.bought) * 1000) / 10 : null,
      low: !!r.low,
    }))
    .sort((a, b) => b.sold - a.sold || (b.sellThrough ?? -1) - (a.sellThrough ?? -1) || a.product.localeCompare(b.product) || a.color.localeCompare(b.color));
}

// ─── Per salesperson ───────────────────────────────────────────────────────

export type DealGroup = { ownerId: string; stage: string; currency: string; count: number; amount: number };
export type CollectedGroup = { ownerId: string; currency: string; amount: number };

/**
 * One row per salesperson from deals grouped by owner, stage and currency. `won` counts the deals closed as won in the
 * period (the caller passes only those in `closed`); open pipeline is every live deal still in progress. Conversion is
 * won / (won + lost) in the period, null when none were closed.
 */
export function buildSalespeople(
  people: { id: string; name: string }[],
  closed: DealGroup[],
  open: DealGroup[],
  collected: CollectedGroup[],
) {
  const rows = people.map((p) => ({
    userId: p.id,
    name: p.name,
    won: 0,
    lost: 0,
    conversion: null as number | null,
    wonValue: {} as MoneyMap,
    openDeals: 0,
    openValue: {} as MoneyMap,
    collected: {} as MoneyMap,
  }));
  const by = new Map(rows.map((r) => [r.userId, r]));
  for (const g of closed) {
    const r = by.get(g.ownerId);
    if (!r) continue;
    if (g.stage === "CLOSED_WON") {
      r.won += g.count;
      addMoney(r.wonValue, g.currency, g.amount);
    } else if (g.stage === "CLOSED_LOST") r.lost += g.count;
  }
  for (const g of open) {
    const r = by.get(g.ownerId);
    if (!r) continue;
    r.openDeals += g.count;
    addMoney(r.openValue, g.currency, g.amount);
  }
  for (const c of collected) {
    const r = by.get(c.ownerId);
    if (r) addMoney(r.collected, c.currency, c.amount);
  }
  for (const r of rows) r.conversion = r.won + r.lost > 0 ? Math.round((r.won / (r.won + r.lost)) * 1000) / 10 : null;
  return rows.filter((r) => r.won + r.lost + r.openDeals > 0 || Object.keys(r.collected).length > 0).sort((a, b) => b.won - a.won || a.name.localeCompare(b.name));
}

/** Loads the groups for every salesperson of the business over the last `months` months. Admins only (the route enforces it). */
export async function loadSalespeople(tenantId: string, months: number, now = new Date()) {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const [people, closedRaw, openRaw, collectedRaw] = await Promise.all([
    db.user.findMany({ where: { tenantId }, select: { id: true, name: true } }),
    db.deal.groupBy({ by: ["ownerId", "stage", "currency"], where: { tenantId, deletedAt: null, stage: { in: ["CLOSED_WON", "CLOSED_LOST"] }, closedAt: { gte: from } }, _count: { _all: true }, _sum: { amount: true } }),
    db.deal.groupBy({ by: ["ownerId", "stage", "currency"], where: { tenantId, deletedAt: null, stage: { notIn: ["CLOSED_WON", "CLOSED_LOST"] } }, _count: { _all: true }, _sum: { amount: true } }),
    db.$queryRaw<{ ownerId: string; currency: string; amount: unknown }[]>(Prisma.sql`
      SELECT d."ownerId", d.currency, SUM(p.amount) AS amount
      FROM "Payment" p JOIN "Deal" d ON d.id = p."dealId"
      WHERE p."tenantId" = ${tenantId} AND d."tenantId" = ${tenantId} AND d."deletedAt" IS NULL AND p."paidAt" >= ${from}
      GROUP BY d."ownerId", d.currency`),
  ]);
  const group = (g: { ownerId: string; stage: string; currency: string; _count: { _all: number }; _sum: { amount: Prisma.Decimal | null } }): DealGroup => ({
    ownerId: g.ownerId,
    stage: g.stage,
    currency: g.currency,
    count: g._count._all,
    amount: Number(g._sum.amount ?? 0),
  });
  return buildSalespeople(
    people,
    closedRaw.map(group),
    openRaw.map(group),
    collectedRaw.map((c) => ({ ownerId: c.ownerId, currency: c.currency, amount: Number(c.amount) })),
  );
}
