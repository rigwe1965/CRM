import { Prisma, type DealStage } from "@prisma/client";
import { db } from "@/lib/db";
import { addMoney, type MoneyMap } from "@/lib/money";
import { summarize } from "@/lib/payments";

const DAY = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Stages where the customer has agreed to buy, so an unpaid balance is genuinely owed to us. */
const OWED_STAGES: DealStage[] = ["PROPOSAL", "NEGOTIATION", "CLOSED_WON"];

type ProfitRow = { currency: string; revenue: unknown; cost: unknown };

/**
 * Profit per currency from summed resale revenue and (scaled) cost. Only lines with a resale
 * price are summed, so revenue and cost cover the same pieces.
 */
export function profitByCurrency(rows: ProfitRow[]) {
  return Object.fromEntries(
    rows.map(({ currency, revenue: r, cost: c }) => {
      const revenue = Number(r ?? 0);
      const cost = Number(c ?? 0);
      return [
        currency,
        {
          estimated: round2(revenue - cost),
          revenue: round2(revenue),
          cost: round2(cost),
          // Share of resale revenue kept as profit; null until there is a resale price on a line.
          margin: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : null,
        },
      ];
    }),
  );
}

/** Owed-stage deals that still have a balance or an uncovered instalment (`dealOwner` scopes them). */
const openDealsSql = (dealOwner: Prisma.Sql) => Prisma.sql`
  SELECT d.id, d.amount, d.currency, COALESCE(p.paid, 0) AS paid
  FROM "Deal" d
  LEFT JOIN (SELECT "dealId", SUM(amount) AS paid FROM "Payment" GROUP BY "dealId") p ON p."dealId" = d.id
  LEFT JOIN (SELECT "dealId", SUM(amount) AS due FROM "Instalment" GROUP BY "dealId") s ON s."dealId" = d.id
  WHERE d."deletedAt" IS NULL ${dealOwner}
    AND d.stage::text IN (${Prisma.join(OWED_STAGES)})
    AND (d.amount > COALESCE(p.paid, 0) OR COALESCE(s.due, 0) > COALESCE(p.paid, 0))`;

/**
 * Money in, money owed, money late, and an estimated profit, for the caller's data (`owned` is
 * the usual ownerScope). Every amount is kept per currency: currencies are never added together.
 *
 * Collected and profit are summed in the database, so their cost does not grow with history.
 * Owed and overdue need the per-deal instalment logic (`summarize`), so only deals that still
 * have something outstanding (and their instalments) are loaded; fully paid deals cost nothing.
 */
export async function cashflow(owned: { ownerId?: string }, now = new Date()) {
  const since = new Date(now.getTime() - 30 * DAY);
  const dealOwner = owned.ownerId ? Prisma.sql`AND d."ownerId" = ${owned.ownerId}` : Prisma.empty;
  const invoiceOwner = owned.ownerId ? Prisma.sql`AND i."ownerId" = ${owned.ownerId}` : Prisma.empty;

  const [collectedRows, profitRows, openDeals, openInstalments] = await Promise.all([
    // A payment is in its deal's currency.
    db.$queryRaw<{ currency: string; total: unknown; recent: unknown }[]>`
      SELECT d.currency,
             SUM(p.amount) AS total,
             COALESCE(SUM(p.amount) FILTER (WHERE p."paidAt" >= ${since}), 0) AS recent
      FROM "Payment" p JOIN "Deal" d ON d.id = p."dealId"
      WHERE d."deletedAt" IS NULL ${dealOwner}
      GROUP BY d.currency`,
    // Cost is scaled to what was actually agreed (deal price incl. shipping) rather than the sheet
    // total. Resale prices are assumed to be in the invoice's currency.
    db.$queryRaw<ProfitRow[]>`
      SELECT i.currency,
             SUM(it."resalePrice" * it.quantity) AS revenue,
             SUM(it."lineTotal" * CASE WHEN i.subtotal > 0 THEN i.total / i.subtotal ELSE 1 END) AS cost
      FROM "InvoiceItem" it JOIN "Invoice" i ON i.id = it."invoiceId"
      WHERE it."resalePrice" IS NOT NULL AND i.status <> 'CANCELLED' ${invoiceOwner}
      GROUP BY i.currency`,
    // Deals with a balance, or with an instalment the payments don't fully cover, with what they
    // have paid so far. Joined aggregates (not per-row subqueries) keep this fast on large tables.
    db.$queryRaw<{ id: string; amount: unknown; currency: string; paid: unknown }[]>(openDealsSql(dealOwner)),
    db.$queryRaw<{ dealId: string; id: string; position: number; dueDate: Date; amount: Prisma.Decimal }[]>`
      SELECT s."dealId", s.id, s.position, s."dueDate", s.amount FROM "Instalment" s
      WHERE s."dealId" IN (SELECT o.id FROM (${openDealsSql(dealOwner)}) o)`,
  ]);

  const scheduleOf = new Map<string, typeof openInstalments>();
  for (const i of openInstalments) {
    const list = scheduleOf.get(i.dealId);
    if (list) list.push(i);
    else scheduleOf.set(i.dealId, [i]);
  }

  const collected: MoneyMap = {};
  const collectedRecent: MoneyMap = {};
  for (const r of collectedRows) {
    addMoney(collected, r.currency, Number(r.total ?? 0));
    addMoney(collectedRecent, r.currency, Number(r.recent ?? 0));
  }

  const owed: MoneyMap = {};
  const overdue: MoneyMap = {};
  let owedDealCount = 0;
  let overdueDealCount = 0;
  for (const d of openDeals) {
    const paid = Number(d.paid);
    const balance = Number(d.amount) - paid;
    if (balance > 0) {
      addMoney(owed, d.currency, balance);
      owedDealCount++;
    }
    const late = summarize(Number(d.amount), paid, scheduleOf.get(d.id) ?? []).instalments.filter((i) => i.overdue);
    if (late.length) {
      addMoney(overdue, d.currency, late.reduce((s, i) => s + (i.amount - i.covered), 0));
      overdueDealCount++;
    }
  }

  return {
    collected: { total: collected, last30Days: collectedRecent },
    owed: { amount: owed, deals: owedDealCount },
    overdue: { amount: overdue, deals: overdueDealCount },
    profit: profitByCurrency(profitRows),
  };
}
