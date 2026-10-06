import type { DealStage } from "@prisma/client";
import { db } from "@/lib/db";
import { summarize } from "@/lib/payments";

const DAY = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Stages where the customer has agreed to buy, so an unpaid balance is genuinely owed to us. */
const OWED_STAGES: DealStage[] = ["PROPOSAL", "NEGOTIATION", "CLOSED_WON"];

/**
 * Money in, money owed, money late, and an estimated profit, for the caller's data (`owned` is
 * the usual ownerScope). Amounts are summed as plain numbers, so a single currency is assumed.
 */
export async function cashflow(owned: { ownerId?: string }, now = new Date()) {
  const since = new Date(now.getTime() - 30 * DAY);
  const deal = { deletedAt: null, ...owned };

  const [collected, collectedRecent, owedDeals, invoices] = await Promise.all([
    db.payment.aggregate({ where: { deal }, _sum: { amount: true } }),
    db.payment.aggregate({ where: { deal, paidAt: { gte: since } }, _sum: { amount: true } }),
    db.deal.findMany({
      where: { ...deal, stage: { in: OWED_STAGES } },
      select: { amount: true, payments: { select: { amount: true } }, instalments: true },
    }),
    db.invoice.findMany({
      where: { ...owned, status: { not: "CANCELLED" } },
      select: { subtotal: true, total: true, items: { select: { quantity: true, lineTotal: true, resalePrice: true } } },
    }),
  ]);

  let owed = 0;
  let owedDealCount = 0;
  let overdue = 0;
  let overdueDealCount = 0;
  for (const d of owedDeals) {
    const paid = d.payments.reduce((s, p) => s + Number(p.amount), 0);
    const balance = Number(d.amount) - paid;
    if (balance > 0) {
      owed += balance;
      owedDealCount++;
    }
    const late = summarize(Number(d.amount), paid, d.instalments).instalments.filter((i) => i.overdue);
    if (late.length) {
      overdue += late.reduce((s, i) => s + (i.amount - i.covered), 0);
      overdueDealCount++;
    }
  }

  // Profit uses only lines that have a resale price, so revenue and cost cover the same pieces.
  // Cost is scaled to what was actually agreed (deal price incl. shipping) rather than the sheet total.
  let revenue = 0;
  let cost = 0;
  for (const inv of invoices) {
    const subtotal = Number(inv.subtotal);
    const scale = subtotal > 0 ? Number(inv.total) / subtotal : 1;
    for (const i of inv.items) {
      if (i.resalePrice === null) continue;
      revenue += Number(i.resalePrice) * i.quantity;
      cost += Number(i.lineTotal) * scale;
    }
  }

  return {
    collected: { total: Number(collected._sum.amount ?? 0), last30Days: Number(collectedRecent._sum.amount ?? 0) },
    owed: { amount: round2(owed), deals: owedDealCount },
    overdue: { amount: round2(overdue), deals: overdueDealCount },
    profit: {
      estimated: round2(revenue - cost),
      revenue: round2(revenue),
      cost: round2(cost),
      // Share of resale revenue kept as profit; null until there is a resale price on a line.
      margin: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : null,
    },
  };
}
