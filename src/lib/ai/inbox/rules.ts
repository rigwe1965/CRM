import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth-helpers";
import { authorScope, ownerScope, taskScope } from "@/lib/access";
import { paymentSummaries } from "@/lib/payments";
import { canReplyFreely } from "@/lib/whatsapp";

/**
 * The daily inbox's rules (AI_ASSISTANT_PLAN.md, Phase 3b). Rules decide what deserves attention, with no model call:
 * plain queries through the person's own scope, so a salesperson only ever gets candidates about their own records. The
 * model only writes the words afterwards (src/lib/ai/inbox/wording.ts); it never chooses a customer, a deal or an amount.
 */

export const MAX_SUGGESTIONS = 10;
const DAY = 86_400_000;

export type Rule = "OVERDUE_INSTALMENT" | "STALE_NEGOTIATION" | "WON_NO_SCHEDULE" | "OVERDUE_TASK";

/** What the card will do. Values here are exactly what `prepare` will validate again. */
export type Candidate = {
  rule: Rule;
  /** Rule, record and ISO week: the same suggestion is not made twice in a week, even if it was declined. */
  key: string;
  priority: number;
  subject: { type: "deal" | "task"; id: string };
  /** Built from data, shown on the card as "why". */
  reason: string;
  /** Plain facts for the wording step. Names and amounts only; free text from records is clipped and marked untrusted there. */
  facts: { customer: string | null; deal: string | null; amountText: string | null; daysLate: number | null; dueDate: string | null; recentSubjects: string[] };
  task: { title: string; priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT"; dueDate: string; contactId?: string; dealId?: string } | null;
  /** A reschedule of an existing task (OVERDUE_TASK only). */
  taskChange: { taskId: string; dueDate: string } | null;
  /** A reminder draft, if there is a channel that can be used right now. */
  message: { contactId: string; channel: "WHATSAPP" | "EMAIL"; subject?: string; text: string; allowed: (string | null)[] } | null;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const name = (c: { firstName: string; lastName: string } | null | undefined) => (c ? `${c.firstName} ${c.lastName === "-" ? "" : c.lastName}`.trim() : null);

/** `2026-W44`: ISO week of the UTC date, so a key changes every Monday. */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t.getTime() - yearStart.getTime()) / DAY + 1) / 7)).padStart(2, "0")}`;
}

const money = (n: number, cur: string) => `${n.toFixed(2)} ${cur}`;

/** Every candidate for one person, highest priority first, capped at MAX_SUGGESTIONS. */
export async function findCandidates(user: SessionUser, now = new Date()): Promise<Candidate[]> {
  const owned = ownerScope(user);
  const today = startOfDay(now);
  const week = isoWeek(now);
  const all: Candidate[] = [];

  // ── Overdue instalments with no follow-up in the last 3 days ─────────────────────────────────────────────────
  const lateDeals = await db.deal.findMany({
    where: { AND: [{ deletedAt: null }, owned, { stage: { not: "CLOSED_LOST" } }, { instalments: { some: { dueDate: { lt: today } } } }] },
    select: { id: true, title: true, amount: true, currency: true, contactId: true, contact: { select: { id: true, firstName: true, lastName: true, email: true, emailOptOut: true, phoneE164: true, whatsappOptIn: true } } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  const sums = await paymentSummaries(lateDeals);
  const late = lateDeals.filter((d) => sums.get(d.id)?.overdue && sums.get(d.id)?.nextDue);

  const touchedSince = new Date(now.getTime() - 3 * DAY);
  const lateIds = late.map((d) => d.id);
  const lateContacts = late.map((d) => d.contactId).filter((c): c is string => !!c);
  const [recentActs, recentTasks] =
    late.length === 0
      ? [[], []]
      : await Promise.all([
          db.activity.findMany({ where: { AND: [authorScope(user), { occurredAt: { gte: touchedSince } }, { OR: [{ dealId: { in: lateIds } }, { contactId: { in: lateContacts } }] }] }, select: { dealId: true, contactId: true, subject: true } }),
          db.task.findMany({ where: { AND: [taskScope(user), { createdAt: { gte: touchedSince } }, { OR: [{ dealId: { in: lateIds } }, { contactId: { in: lateContacts } }] }] }, select: { dealId: true, contactId: true } }),
        ]);

  for (const d of late) {
    if (recentActs.some((a) => a.dealId === d.id || (d.contactId && a.contactId === d.contactId)) || recentTasks.some((t) => t.dealId === d.id || (d.contactId && t.contactId === d.contactId))) continue;
    const due = sums.get(d.id)!.nextDue!;
    const days = Math.max(1, Math.floor((today.getTime() - startOfDay(due.dueDate).getTime()) / DAY));
    const customer = name(d.contact);
    const amountText = money(due.amount, d.currency);
    const first = d.contact?.firstName ?? "there";
    const text = `Hi ${first}, a quick reminder that ${amountText} for your order "${d.title}" was due on ${iso(due.dueDate)}. Could you let me know when to expect it? Thank you.`;
    let message: Candidate["message"] = null;
    if (d.contact) {
      if (d.contact.phoneE164 && d.contact.whatsappOptIn && (await canReplyFreely(user.tenantId, d.contact.id, now))) message = { contactId: d.contact.id, channel: "WHATSAPP", text, allowed: [d.contact.phoneE164] };
      else if (d.contact.email && !d.contact.emailOptOut) message = { contactId: d.contact.id, channel: "EMAIL", subject: `Payment reminder: ${d.title}`.slice(0, 200), text, allowed: [d.contact.email] };
    }
    all.push({
      rule: "OVERDUE_INSTALMENT",
      key: `inst:${d.id}:${week}`,
      priority: 100 + Math.min(days, 90),
      subject: { type: "deal", id: d.id },
      reason: `${amountText} on "${d.title}" has been overdue for ${days} day${days === 1 ? "" : "s"}, and nobody has followed up in the last 3 days.`,
      facts: { customer, deal: d.title, amountText, daysLate: days, dueDate: iso(due.dueDate), recentSubjects: [] },
      task: { title: `Follow up on overdue payment: ${customer ?? d.title}`.slice(0, 200), priority: days >= 7 ? "HIGH" : "MEDIUM", dueDate: iso(today), ...(d.contactId ? { contactId: d.contactId } : {}), dealId: d.id },
      taskChange: null,
      message,
    });
  }

  // ── Deals in Negotiation with no activity for 14 days ────────────────────────────────────────────────────────
  const staleSince = new Date(now.getTime() - 14 * DAY);
  const negotiating = await db.deal.findMany({
    where: { AND: [{ deletedAt: null }, owned, { stage: "NEGOTIATION" }, { updatedAt: { lt: staleSince } }] },
    select: { id: true, title: true, updatedAt: true, contactId: true, contact: { select: { firstName: true, lastName: true } } },
    orderBy: { updatedAt: "asc" },
    take: 50,
  });
  if (negotiating.length) {
    const ids = negotiating.map((d) => d.id);
    const cids = negotiating.map((d) => d.contactId).filter((c): c is string => !!c);
    const acts = await db.activity.findMany({ where: { AND: [authorScope(user), { occurredAt: { gte: staleSince } }, { OR: [{ dealId: { in: ids } }, { contactId: { in: cids } }] }] }, select: { dealId: true, contactId: true } });
    for (const d of negotiating) {
      if (acts.some((a) => a.dealId === d.id || (d.contactId && a.contactId === d.contactId))) continue;
      const days = Math.floor((today.getTime() - startOfDay(d.updatedAt).getTime()) / DAY);
      all.push({
        rule: "STALE_NEGOTIATION",
        key: `stale:${d.id}:${week}`,
        priority: 50 + Math.min(days, 49),
        subject: { type: "deal", id: d.id },
        reason: `"${d.title}" has been in Negotiation for ${days} days with no activity.`,
        facts: { customer: name(d.contact), deal: d.title, amountText: null, daysLate: days, dueDate: null, recentSubjects: [] },
        task: { title: `Follow up on "${d.title}"`.slice(0, 200), priority: "MEDIUM", dueDate: iso(today), ...(d.contactId ? { contactId: d.contactId } : {}), dealId: d.id },
        taskChange: null,
        message: null,
      });
    }
  }

  // ── Won deals with money owed and no schedule ────────────────────────────────────────────────────────────────
  const wonSince = new Date(now.getTime() - 2 * DAY);
  const won = await db.deal.findMany({
    where: { AND: [{ deletedAt: null }, owned, { stage: "CLOSED_WON" }, { closedAt: { lt: wonSince } }, { instalments: { none: {} } }] },
    select: { id: true, title: true, amount: true, currency: true, contactId: true, contact: { select: { firstName: true, lastName: true } } },
    orderBy: { closedAt: "asc" },
    take: 50,
  });
  const wonSums = await paymentSummaries(won);
  for (const d of won) {
    const balance = wonSums.get(d.id)?.balance ?? 0;
    if (balance <= 0) continue;
    all.push({
      rule: "WON_NO_SCHEDULE",
      key: `plan:${d.id}:${week}`,
      priority: 40,
      subject: { type: "deal", id: d.id },
      reason: `"${d.title}" is won with ${money(balance, d.currency)} still unpaid and no payment schedule.`,
      facts: { customer: name(d.contact), deal: d.title, amountText: money(balance, d.currency), daysLate: null, dueDate: null, recentSubjects: [] },
      task: { title: `Agree a payment plan for "${d.title}"`.slice(0, 200), priority: "MEDIUM", dueDate: iso(today), ...(d.contactId ? { contactId: d.contactId } : {}), dealId: d.id },
      taskChange: null,
      message: null,
    });
  }

  // ── The person's own tasks that are well overdue ─────────────────────────────────────────────────────────────
  const overdueBefore = new Date(today.getTime() - 2 * DAY);
  const tasks = await db.task.findMany({
    where: { AND: [taskScope(user), { assigneeId: user.id, status: { in: ["TODO", "IN_PROGRESS"] }, dueDate: { lt: overdueBefore } } satisfies Prisma.TaskWhereInput] },
    select: { id: true, title: true, dueDate: true },
    orderBy: { dueDate: "asc" },
    take: 20,
  });
  for (const t of tasks) {
    const days = Math.floor((today.getTime() - startOfDay(t.dueDate!).getTime()) / DAY);
    all.push({
      rule: "OVERDUE_TASK",
      key: `task:${t.id}:${week}`,
      priority: 30 + Math.min(days, 29),
      subject: { type: "task", id: t.id },
      reason: `"${t.title}" was due ${days} days ago and is still open.`,
      facts: { customer: null, deal: null, amountText: null, daysLate: days, dueDate: iso(t.dueDate!), recentSubjects: [] },
      task: null,
      taskChange: { taskId: t.id, dueDate: iso(new Date(today.getTime() + DAY)) },
      message: null,
    });
  }

  return all.sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key)).slice(0, MAX_SUGGESTIONS);
}
