import { z } from "zod";
import { db } from "@/lib/db";
import { cashflow } from "@/lib/cashflow";
import { addMoney, type MoneyMap } from "@/lib/money";
import { summarize } from "@/lib/payments";
import { reconcileTenant } from "@/lib/reconcile";
import { fullName, isoDate } from "@/lib/ai/tools/result";
import { defineTool } from "@/lib/ai/tools/types";

/** Tools over what customers owe and what has come in. Amounts are per currency and are never added across currencies. */

const DAY_MS = 86_400_000;
const BATCH = 500;
/** Deals read in one go when looking for late instalments; a business with more than this gets a note that the list is partial. */
const MAX_SCAN = 2000;
const MAX_ROWS = 25;
/** Where a customer has agreed to buy, so an unpaid balance is genuinely owed (the same stages the dashboard uses). */
const OWED_STAGES = ["PROPOSAL", "NEGOTIATION", "CLOSED_WON"] as const;

export const listOverdue = defineTool({
  name: "list_overdue",
  description:
    "Customer instalments that are overdue or fall due within the next few days, soonest first, with the amount due per deal and totals per currency. Only deals that have an instalment schedule have due dates; deals with a balance but no schedule are not listed here (use find_deals or cash_flow for those).",
  schema: z.object({ withinDays: z.number().int().min(0).max(60).default(7).describe("Also include instalments due within this many days.") }),
  label: () => "Checking overdue payments",
  fallbackLabel: "Checking overdue payments",
  run: async ({ owned, now }, i) => {
    const today = now.toISOString().slice(0, 10);
    const horizon = new Date(now.getTime() + i.withinDays * DAY_MS).toISOString().slice(0, 10);
    const rows: { dealId: string; deal: string; customer: string | null; currency: string; amountDue: number; due: string; overdue: boolean; balance: number }[] = [];
    const overdueTotals: MoneyMap = {};
    const dueSoonTotals: MoneyMap = {};
    let scanned = 0;
    let cursor: string | undefined;

    while (scanned < MAX_SCAN) {
      const deals = await db.deal.findMany({
        where: { ...owned, deletedAt: null, stage: { in: [...OWED_STAGES] } },
        orderBy: { id: "asc" },
        take: BATCH,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: {
          id: true, title: true, amount: true, currency: true, contact: { select: { firstName: true, lastName: true } },
          payments: { select: { amount: true } }, instalments: { select: { id: true, position: true, dueDate: true, amount: true } },
        },
      });
      if (deals.length === 0) break;
      for (const d of deals) {
        scanned++;
        if (d.instalments.length === 0) continue;
        const paid = d.payments.reduce((s, p) => s + Number(p.amount), 0);
        const { summary, instalments } = summarize(Number(d.amount), paid, d.instalments, today);
        const late = instalments.filter((x) => x.overdue);
        const base = { dealId: d.id, deal: d.title, customer: fullName(d.contact), currency: d.currency, balance: summary.balance };
        if (late.length) {
          const amountDue = late.reduce((s, x) => s + (x.amount - x.covered), 0);
          addMoney(overdueTotals, d.currency, amountDue);
          rows.push({ ...base, amountDue: Math.round(amountDue * 100) / 100, due: isoDate(late[0].dueDate)!, overdue: true });
        } else if (summary.nextDue && isoDate(summary.nextDue.dueDate)! <= horizon) {
          addMoney(dueSoonTotals, d.currency, summary.nextDue.amount);
          rows.push({ ...base, amountDue: summary.nextDue.amount, due: isoDate(summary.nextDue.dueDate)!, overdue: false });
        }
      }
      cursor = deals[deals.length - 1].id;
      if (deals.length < BATCH) break;
    }

    rows.sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.due.localeCompare(b.due) || a.dealId.localeCompare(b.dealId));
    return {
      today,
      withinDays: i.withinDays,
      counts: { overdue: rows.filter((r) => r.overdue).length, dueSoon: rows.filter((r) => !r.overdue).length },
      totals: { overdue: overdueTotals, dueSoon: dueSoonTotals },
      rows: rows.slice(0, MAX_ROWS),
      truncated: rows.length > MAX_ROWS,
      partialScan: scanned >= MAX_SCAN,
    };
  },
});

export const cashFlow = defineTool({
  name: "cash_flow",
  description: "The money picture: how much has been collected (in total and in the last 30 days), how much customers still owe, how much of that is overdue, and estimated profit. Every figure is per currency.",
  schema: z.object({}),
  label: () => "Checking cash flow",
  fallbackLabel: "Checking cash flow",
  run: ({ owned, now }) => cashflow(owned, now),
});

export const moneyChecks = defineTool({
  name: "money_checks",
  description:
    "Deals whose money does not add up: overpaid, instalments or line items that do not match the deal amount, online payments not matched to Stripe, dead payment links, won deals with a balance but no schedule. Each finding says what is wrong and what to do about it.",
  schema: z.object({}),
  label: () => "Running the money checks",
  fallbackLabel: "Running the money checks",
  run: async ({ owned }) => {
    const r = await reconcileTenant(owned, MAX_ROWS);
    return {
      dealsChecked: r.checked,
      counts: r.counts,
      truncated: r.truncated,
      findings: r.findings.map((f) => ({ dealId: f.dealId, deal: f.dealTitle, kind: f.kind, severity: f.severity, currency: f.currency, problem: f.detail, fix: f.fix })),
    };
  },
});
