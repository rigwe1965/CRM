import type { DealStage } from "@prisma/client";
import { db } from "@/lib/db";
import { addMoney, type MoneyMap } from "@/lib/money";
import { summarize } from "@/lib/payments";

const DAY = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Stages where the customer has agreed to buy, so an unpaid balance is genuinely owed to us. */
const OWED_STAGES: DealStage[] = ["PROPOSAL", "NEGOTIATION", "CLOSED_WON"];

/**
 * Money in, money owed, money late, and an estimated profit, for the caller's data (`owned` is
 * the usual ownerScope). Every amount is kept per currency: currencies are never added together.
 */
export async function cashflow(owned: { ownerId?: string }, now = new Date()) {
  const since = new Date(now.getTime() - 30 * DAY);
  const deal = { deletedAt: null, ...owned };

  const [payments, owedDeals, invoices] = await Promise.all([
    // A payment is in its deal's currency.
    db.payment.findMany({ where: { deal }, select: { amount: true, paidAt: true, deal: { select: { currency: true } } } }),
    db.deal.findMany({
      where: { ...deal, stage: { in: OWED_STAGES } },
      select: { amount: true, currency: true, payments: { select: { amount: true } }, instalments: true },
    }),
    db.invoice.findMany({
      where: { ...owned, status: { not: "CANCELLED" } },
      select: { currency: true, subtotal: true, total: true, items: { select: { quantity: true, lineTotal: true, resalePrice: true } } },
    }),
  ]);

  const collected: MoneyMap = {};
  const collectedRecent: MoneyMap = {};
  for (const p of payments) {
    addMoney(collected, p.deal.currency, Number(p.amount));
    if (p.paidAt >= since) addMoney(collectedRecent, p.deal.currency, Number(p.amount));
  }

  const owed: MoneyMap = {};
  const overdue: MoneyMap = {};
  let owedDealCount = 0;
  let overdueDealCount = 0;
  for (const d of owedDeals) {
    const paid = d.payments.reduce((s, p) => s + Number(p.amount), 0);
    const balance = Number(d.amount) - paid;
    if (balance > 0) {
      addMoney(owed, d.currency, balance);
      owedDealCount++;
    }
    const late = summarize(Number(d.amount), paid, d.instalments).instalments.filter((i) => i.overdue);
    if (late.length) {
      addMoney(overdue, d.currency, late.reduce((s, i) => s + (i.amount - i.covered), 0));
      overdueDealCount++;
    }
  }

  // Profit uses only lines that have a resale price, so revenue and cost cover the same pieces.
  // Cost is scaled to what was actually agreed (deal price incl. shipping) rather than the sheet total.
  // Resale prices are assumed to be in the invoice's currency.
  const sums: Record<string, { revenue: number; cost: number }> = {};
  for (const inv of invoices) {
    const subtotal = Number(inv.subtotal);
    const scale = subtotal > 0 ? Number(inv.total) / subtotal : 1;
    const s = (sums[inv.currency] ??= { revenue: 0, cost: 0 });
    for (const i of inv.items) {
      if (i.resalePrice === null) continue;
      s.revenue += Number(i.resalePrice) * i.quantity;
      s.cost += Number(i.lineTotal) * scale;
    }
  }
  const profit = Object.fromEntries(
    Object.entries(sums).map(([cur, { revenue, cost }]) => [
      cur,
      {
        estimated: round2(revenue - cost),
        revenue: round2(revenue),
        cost: round2(cost),
        // Share of resale revenue kept as profit; null until there is a resale price on a line.
        margin: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : null,
      },
    ]),
  );

  return {
    collected: { total: collected, last30Days: collectedRecent },
    owed: { amount: owed, deals: owedDealCount },
    overdue: { amount: overdue, deals: overdueDealCount },
    profit,
  };
}
