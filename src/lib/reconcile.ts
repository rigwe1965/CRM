import { db } from "@/lib/db";
import type { OwnerScope } from "@/lib/access";
import { itemsTotal } from "@/lib/deals";

/**
 * Read-only consistency checks on deals and their money. Balance is always `amount - payments`, so it can't drift
 * by itself; what can go wrong is the data around it (a schedule that doesn't add up to the deal, an online payment
 * that was never recorded, an overpayment). This finds those so a person can fix them. It never changes anything.
 * Amounts stay per deal and per currency; nothing is added across currencies.
 */

export type FindingKind =
  | "OVERPAID"
  | "SCHEDULE_MISMATCH"
  | "ITEMS_MISMATCH"
  | "ORPHAN_ONLINE_PAYMENT"
  | "PAID_LINK_WITHOUT_PAYMENT"
  | "REFUND_NEEDED"
  | "STALE_PENDING_LINK"
  | "UNSCHEDULED_BALANCE"
  | "CURRENCY_DRIFT";

export type Finding = {
  kind: FindingKind;
  /** "high" = money may be wrong or owed back; "low" = tidy-up. */
  severity: "high" | "low";
  dealId: string;
  dealTitle: string;
  currency: string;
  detail: string;
};

export type DealForCheck = {
  id: string;
  title: string;
  amount: number;
  currency: string;
  stage: string;
  payments: { amount: number; source: string; providerRef: string | null }[];
  instalments: { amount: number }[];
  items: { quantity: number; unitPrice: number }[];
  paymentLinks: { amount: number; currency: string; status: string; createdAt: Date; hasPayment: boolean }[];
};

/** A pending link older than this is probably abandoned, yet still reserves part of the balance. */
export const STALE_LINK_DAYS = 14;

const cents = (n: number) => Math.round(n * 100);
const fmt = (n: number, cur: string) => `${n.toFixed(2)} ${cur}`;

export function reconcileDeal(deal: DealForCheck, now = new Date()): Finding[] {
  const out: Finding[] = [];
  const add = (kind: FindingKind, severity: Finding["severity"], detail: string, currency = deal.currency) =>
    out.push({ kind, severity, dealId: deal.id, dealTitle: deal.title, currency, detail });

  const total = cents(deal.amount);
  const paid = deal.payments.reduce((s, p) => s + cents(p.amount), 0);

  if (paid > total) {
    add("OVERPAID", "high", `Payments (${fmt(paid / 100, deal.currency)}) are more than the deal (${fmt(total / 100, deal.currency)}). Refund or correct the amount.`);
  }

  if (deal.instalments.length > 0) {
    const scheduled = deal.instalments.reduce((s, i) => s + cents(i.amount), 0);
    if (scheduled !== total) {
      add("SCHEDULE_MISMATCH", "high", `The instalments add up to ${fmt(scheduled / 100, deal.currency)} but the deal is ${fmt(total / 100, deal.currency)}, so reminders chase the wrong amount.`);
    }
  }

  if (deal.items.length > 0) {
    const lines = cents(itemsTotal(deal.items));
    if (lines !== total) {
      add("ITEMS_MISMATCH", "high", `The line items add up to ${fmt(lines / 100, deal.currency)} but the deal is ${fmt(total / 100, deal.currency)}.`);
    }
  }

  const orphans = deal.payments.filter((p) => p.source === "ONLINE" && !p.providerRef).length;
  if (orphans > 0) {
    add("ORPHAN_ONLINE_PAYMENT", "high", `${orphans} online ${orphans === 1 ? "payment has" : "payments have"} no Stripe reference, so it can't be matched to the processor.`);
  }

  for (const link of deal.paymentLinks) {
    if (link.status === "PAID" && !link.hasPayment) {
      add("PAID_LINK_WITHOUT_PAYMENT", "high", `A payment link for ${fmt(link.amount, link.currency)} is marked paid but no payment was recorded.`, link.currency);
    }
    if (link.status === "REFUND_NEEDED") {
      add("REFUND_NEEDED", "high", `A customer paid ${fmt(link.amount, link.currency)} online after the balance had dropped. It was not recorded and must be refunded in Stripe.`, link.currency);
    }
    if (link.status === "PENDING" && now.getTime() - link.createdAt.getTime() > STALE_LINK_DAYS * 86_400_000) {
      add("STALE_PENDING_LINK", "low", `A payment link for ${fmt(link.amount, link.currency)} has been waiting more than ${STALE_LINK_DAYS} days and still reserves part of the balance. Cancel it if it is dead.`, link.currency);
    }
    if (link.currency !== deal.currency) {
      add("CURRENCY_DRIFT", "high", `A payment link is in ${link.currency} but the deal is in ${deal.currency}.`, link.currency);
    }
  }

  if (deal.stage === "CLOSED_WON" && paid < total && deal.instalments.length === 0) {
    add("UNSCHEDULED_BALANCE", "low", `Won deal with ${fmt((total - paid) / 100, deal.currency)} still owed and no instalment schedule, so no reminder will ever go out.`);
  }

  return out;
}

export type ReconcileResult = {
  checked: number;
  findings: Finding[];
  /** True when more findings existed than `limit`. */
  truncated: boolean;
  counts: Partial<Record<FindingKind, number>>;
};

const BATCH = 500;

/**
 * Checks every live deal in the caller's scope (a whole business for an admin). Must run inside `withTenant`
 * (an `authed()` handler, or the daily job) so row-level security applies as well.
 */
export async function reconcileTenant(owned: OwnerScope, limit = 200): Promise<ReconcileResult> {
  const all: Finding[] = [];
  const counts: ReconcileResult["counts"] = {};
  let checked = 0;
  let cursor: string | undefined;

  for (;;) {
    const deals = await db.deal.findMany({
      where: { ...owned, deletedAt: null },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: {
        id: true,
        title: true,
        amount: true,
        currency: true,
        stage: true,
        payments: { select: { amount: true, source: true, providerRef: true } },
        instalments: { select: { amount: true } },
        items: { select: { quantity: true, unitPrice: true } },
        paymentLinks: { select: { amount: true, currency: true, status: true, createdAt: true, payment: { select: { id: true } } } },
      },
    });
    if (deals.length === 0) break;
    for (const d of deals) {
      checked++;
      const found = reconcileDeal({
        id: d.id,
        title: d.title,
        amount: Number(d.amount),
        currency: d.currency,
        stage: d.stage,
        payments: d.payments.map((p) => ({ amount: Number(p.amount), source: p.source, providerRef: p.providerRef })),
        instalments: d.instalments.map((i) => ({ amount: Number(i.amount) })),
        items: d.items.map((i) => ({ quantity: i.quantity, unitPrice: Number(i.unitPrice) })),
        paymentLinks: d.paymentLinks.map((l) => ({ amount: Number(l.amount), currency: l.currency, status: l.status, createdAt: l.createdAt, hasPayment: !!l.payment })),
      });
      for (const f of found) {
        counts[f.kind] = (counts[f.kind] ?? 0) + 1;
        all.push(f);
      }
    }
    cursor = deals[deals.length - 1].id;
    if (deals.length < BATCH) break;
  }

  // High severity first, so the capped list keeps the findings that matter most.
  all.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));
  return { checked, findings: all.slice(0, limit), truncated: all.length > limit, counts };
}
