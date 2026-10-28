import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { OwnerScope } from "@/lib/access";
import { addMoney, type MoneyMap } from "@/lib/money";

const DAY = 86_400_000;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** "2026-10" for a date, in UTC so the same payment lands in the same month for everyone. */
export const monthKey = (d: Date) => d.toISOString().slice(0, 7);

/** The last `n` month keys ending with the month of `now`, oldest first. */
export function lastMonths(n: number, now: Date): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  return out;
}

/** Money received per month, kept per currency (never added across currencies). */
export function revenueByMonth(payments: { amount: number; paidAt: Date; currency: string }[], months: string[]) {
  const rows = months.map((month) => ({ month, revenue: {} as MoneyMap }));
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  for (const p of payments) {
    const row = byMonth.get(monthKey(p.paidAt));
    if (row) addMoney(row.revenue, p.currency, p.amount);
  }
  return rows;
}

/** Average days from order to the payment that completed it, over deals that are fully paid. Null if none are. */
export function averageDaysToPay(deals: { amount: number; createdAt: Date; payments: { amount: number; paidAt: Date }[] }[]) {
  const days: number[] = [];
  for (const d of deals) {
    if (d.amount <= 0 || d.payments.length === 0) continue;
    const sorted = [...d.payments].sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());
    let paid = 0;
    for (const p of sorted) {
      paid += p.amount;
      if (paid + 0.005 >= d.amount) {
        days.push(Math.max(0, (p.paidAt.getTime() - d.createdAt.getTime()) / DAY));
        break;
      }
    }
  }
  return { average: days.length ? round1(days.reduce((s, n) => s + n, 0) / days.length) : null, deals: days.length };
}

/**
 * `averageDaysToPay` computed in the database: a running total of each won deal's payments finds the one that
 * completed it, so no deal or payment rows are loaded however long the history. Same rules as the function above.
 */
export async function averageDaysToPayInDb(owned: OwnerScope) {
  const owner = Prisma.sql`AND d."tenantId" = ${owned.tenantId} ${owned.ownerId ? Prisma.sql`AND d."ownerId" = ${owned.ownerId}` : Prisma.empty}`;
  const [row] = await db.$queryRaw<{ n: number; avg: unknown }[]>`
    WITH running AS (
      SELECT d.id, d.amount, d."createdAt", p."paidAt",
             SUM(p.amount) OVER (PARTITION BY d.id ORDER BY p."paidAt", p.id) AS cum
      FROM "Deal" d JOIN "Payment" p ON p."dealId" = d.id
      WHERE d."deletedAt" IS NULL AND d.stage::text = 'CLOSED_WON' AND d.amount > 0 ${owner}
    ), done AS (
      SELECT DISTINCT ON (id) "createdAt", "paidAt" FROM running WHERE cum + 0.005 >= amount ORDER BY id, "paidAt"
    )
    SELECT COUNT(*)::int AS n, AVG(GREATEST(0, EXTRACT(EPOCH FROM ("paidAt" - "createdAt")) / 86400)) AS avg FROM done`;
  return { average: row.n ? round1(Number(row.avg)) : null, deals: row.n };
}

/** Best sellers by pieces, with what they brought in per currency. */
export function topProducts(items: { productType: string; quantity: number; unitPrice: number; currency: string }[], limit = 8) {
  const by = new Map<string, { product: string; pieces: number; revenue: MoneyMap }>();
  for (const i of items) {
    const key = i.productType.trim().toLowerCase();
    const row = by.get(key) ?? { product: i.productType.trim(), pieces: 0, revenue: {} };
    row.pieces += i.quantity;
    addMoney(row.revenue, i.currency, i.quantity * i.unitPrice);
    by.set(key, row);
  }
  return [...by.values()].sort((a, b) => b.pieces - a.pieces || a.product.localeCompare(b.product)).slice(0, limit);
}

/** Where contacts came from and how many became customers. A blank source is shown as "Not recorded". */
export function leadsBySource(contacts: { source: string | null; type: string }[]) {
  const by = new Map<string, { source: string; contacts: number; customers: number }>();
  for (const c of contacts) {
    const label = c.source?.trim() || "Not recorded";
    const key = label.toLowerCase();
    const row = by.get(key) ?? { source: label, contacts: 0, customers: 0 };
    row.contacts++;
    if (c.type === "CUSTOMER") row.customers++;
    by.set(key, row);
  }
  return [...by.values()]
    .map((r) => ({ ...r, conversion: Math.round((r.customers / r.contacts) * 1000) / 10 }))
    .sort((a, b) => b.contacts - a.contacts || a.source.localeCompare(b.source));
}

/** All the report numbers for the caller's data (`owned` is their owner scope; admins see everything). */
export async function buildReports(owned: OwnerScope, monthsBack: number, now = new Date()) {
  const months = lastMonths(monthsBack, now);
  const from = new Date(`${months[0]}-01T00:00:00.000Z`);
  const liveDeal: Prisma.DealWhereInput = { deletedAt: null, ...owned };

  const [payments, daysToPay, wonItems, contacts] = await Promise.all([
    db.payment.findMany({
      where: { tenantId: owned.tenantId, paidAt: { gte: from }, deal: liveDeal },
      select: { amount: true, paidAt: true, deal: { select: { currency: true } } },
    }),
    averageDaysToPayInDb(owned),
    db.dealItem.findMany({
      where: { deal: { ...liveDeal, stage: "CLOSED_WON", closedAt: { gte: from } } },
      select: { productType: true, quantity: true, unitPrice: true, deal: { select: { currency: true } } },
    }),
    db.contact.findMany({ where: { deletedAt: null, ...owned, createdAt: { gte: from } }, select: { source: true, type: true } }),
  ]);

  return {
    months: monthsBack,
    revenueByMonth: revenueByMonth(
      payments.map((p) => ({ amount: Number(p.amount), paidAt: p.paidAt, currency: p.deal.currency })),
      months,
    ),
    daysToPay,
    topProducts: topProducts(wonItems.map((i) => ({ productType: i.productType, quantity: i.quantity, unitPrice: Number(i.unitPrice), currency: i.deal.currency }))),
    leadsBySource: leadsBySource(contacts),
  };
}
