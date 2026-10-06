import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

const round2 = (n: number) => Math.round(n * 100) / 100;
const day = (d: Date) => d.toISOString().slice(0, 10);

export type InstalmentStatus = {
  id: string;
  position: number;
  dueDate: Date;
  amount: number;
  /** How much of this instalment the payments received so far cover. */
  covered: number;
  overdue: boolean;
};

export type PaymentSummary = {
  paid: number;
  balance: number;
  /** First instalment not fully covered; null when there is no schedule or it is fully covered. */
  nextDue: { dueDate: Date; amount: number } | null;
  overdue: boolean;
};

/**
 * Applies payments to the schedule oldest-first (no manual ticking), and works out the balance.
 * A deal with no schedule just has a balance. Overdue = the first uncovered instalment is past due
 * (due today is not overdue yet).
 */
export function summarize(
  dealAmount: number,
  paid: number,
  schedule: { id: string; position: number; dueDate: Date; amount: Prisma.Decimal | number }[],
  today = day(new Date()),
) {
  let remaining = paid;
  const instalments: InstalmentStatus[] = [...schedule]
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.position - b.position)
    .map((i) => {
      const amount = Number(i.amount);
      const covered = round2(Math.min(remaining, amount));
      remaining = round2(remaining - covered);
      return { id: i.id, position: i.position, dueDate: i.dueDate, amount, covered, overdue: covered < amount && day(i.dueDate) < today };
    });
  const next = instalments.find((i) => i.covered < i.amount);
  const summary: PaymentSummary = {
    paid: round2(paid),
    balance: round2(dealAmount - paid),
    nextDue: next ? { dueDate: next.dueDate, amount: round2(next.amount - next.covered) } : null,
    overdue: !!next?.overdue,
  };
  return { summary, instalments };
}

/** Summaries for many deals at once (used by the deals list). */
export async function paymentSummaries(deals: { id: string; amount: Prisma.Decimal | number }[]) {
  const ids = deals.map((d) => d.id);
  if (ids.length === 0) return new Map<string, PaymentSummary>();
  const [sums, schedule] = await Promise.all([
    db.payment.groupBy({ by: ["dealId"], where: { dealId: { in: ids } }, _sum: { amount: true } }),
    db.instalment.findMany({ where: { dealId: { in: ids } } }),
  ]);
  const paid = new Map(sums.map((s) => [s.dealId, Number(s._sum.amount ?? 0)]));
  return new Map(
    deals.map((d) => [
      d.id,
      summarize(Number(d.amount), paid.get(d.id) ?? 0, schedule.filter((i) => i.dealId === d.id)).summary,
    ]),
  );
}

/** Everything the payments dialog needs for one deal. Caller must have checked access to the deal. */
export async function dealPaymentsView(deal: { id: string; amount: Prisma.Decimal | number; currency: string }) {
  const [payments, schedule] = await Promise.all([
    db.payment.findMany({
      where: { dealId: deal.id },
      include: { recordedBy: { select: { id: true, name: true } } },
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    }),
    db.instalment.findMany({ where: { dealId: deal.id } }),
  ]);
  const paid = payments.reduce((s, p) => s + Number(p.amount), 0);
  const { summary, instalments } = summarize(Number(deal.amount), paid, schedule);
  return {
    dealAmount: Number(deal.amount),
    currency: deal.currency,
    summary,
    instalments,
    payments: payments.map((p) => ({ ...p, amount: Number(p.amount) })),
  };
}
