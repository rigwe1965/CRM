import type { DealStage } from "@prisma/client";
import { db } from "@/lib/db";
import { dealStageEmail, instalmentReminderEmail, taskReminderEmail } from "@/lib/email-templates";
import { isClosed } from "@/lib/deals";
import { trySendMail } from "@/lib/mail";
import { summarize } from "@/lib/payments";

/**
 * Emails the people who should know a deal changed stage: its owner, plus all active admins when
 * the deal is closed (won or lost). The person who made the change is never emailed about it.
 * Never throws: a mail failure must not fail the stage change that triggered it.
 */
export async function notifyDealStageChange(opts: {
  deal: { id: string; title: string; amount: unknown; currency: string; ownerId: string; lostReason: string | null };
  from: DealStage;
  to: DealStage;
  actor: { id: string; name: string };
}) {
  const { deal, from, to, actor } = opts;
  if (from === to) return;
  try {
    const recipients = await db.user.findMany({
      where: {
        isActive: true,
        id: { not: actor.id },
        OR: [{ id: deal.ownerId }, ...(isClosed(to) ? [{ role: "ADMIN" as const }] : [])],
      },
      select: { email: true },
    });
    if (recipients.length === 0) return;
    const mail = dealStageEmail({
      dealId: deal.id,
      title: deal.title,
      amount: Number(deal.amount),
      currency: deal.currency,
      from,
      to,
      actorName: actor.name,
      lostReason: deal.lostReason,
    });
    // One message per recipient so addresses aren't shared between users.
    await Promise.all(recipients.map((r) => trySendMail({ to: r.email, ...mail })));
  } catch (e) {
    console.error("[notify] deal stage notification failed", e);
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Sends one digest per assignee for open tasks that are overdue or due within 24 hours and have
 * not been reminded about yet, then stamps `reminderSentAt` so each task is only mentioned once.
 * Changing a task's due date clears the stamp (see the tasks PATCH handler).
 */
export async function sendTaskReminders(now = new Date()) {
  const tasks = await db.task.findMany({
    where: {
      status: { in: ["TODO", "IN_PROGRESS"] },
      dueDate: { not: null, lte: new Date(now.getTime() + DAY_MS) },
      reminderSentAt: null,
      assignee: { isActive: true },
    },
    select: { id: true, title: true, dueDate: true, assignee: { select: { id: true, name: true, email: true } } },
    orderBy: { dueDate: "asc" },
    take: 1000,
  });

  const byUser = new Map<string, { name: string; email: string; tasks: typeof tasks }>();
  for (const t of tasks) {
    const entry = byUser.get(t.assignee.id) ?? { name: t.assignee.name, email: t.assignee.email, tasks: [] };
    entry.tasks.push(t);
    byUser.set(t.assignee.id, entry);
  }

  let emails = 0;
  let failed = 0;
  for (const { name, email, tasks: mine } of byUser.values()) {
    const mail = taskReminderEmail(
      name,
      mine.map((t) => ({ title: t.title, dueDate: t.dueDate!, overdue: t.dueDate! < now })),
    );
    // Stamp only after the provider accepted the message, so a failed send is retried next run.
    if (await trySendMail({ to: email, ...mail })) {
      await db.task.updateMany({
        where: { id: { in: mine.map((t) => t.id) }, reminderSentAt: null },
        data: { reminderSentAt: now },
      });
      emails++;
    } else {
      failed++;
    }
  }
  return { tasks: tasks.length, emails, failed };
}

/**
 * Sends one digest per deal owner for instalments that are overdue or due within 24 hours and
 * still have an unpaid part, then stamps `reminderSentAt` so each instalment is only mentioned once.
 * Instalments already covered by payments are stamped without an email (nothing to chase).
 * Re-saving a deal's schedule creates fresh instalments, so they can be reminded again.
 */
export async function sendInstalmentReminders(now = new Date()) {
  const due = await db.instalment.findMany({
    where: {
      reminderSentAt: null,
      dueDate: { lte: new Date(now.getTime() + DAY_MS) },
      deal: { deletedAt: null, stage: { not: "CLOSED_LOST" }, owner: { isActive: true } },
    },
    select: {
      id: true,
      dealId: true,
      deal: {
        select: {
          title: true,
          amount: true,
          currency: true,
          owner: { select: { id: true, name: true, email: true } },
          contact: { select: { firstName: true, lastName: true } },
          payments: { select: { amount: true } },
          instalments: { select: { id: true, position: true, dueDate: true, amount: true } },
        },
      },
    },
    orderBy: { dueDate: "asc" },
    take: 1000,
  });

  type Row = { id: string; customer: string; dueDate: Date; amountDue: number; currency: string; overdue: boolean };
  const byOwner = new Map<string, { name: string; email: string; rows: Row[] }>();
  const nothingToChase: string[] = [];

  for (const inst of due) {
    const { deal } = inst;
    const paid = deal.payments.reduce((s, p) => s + Number(p.amount), 0);
    const status = summarize(Number(deal.amount), paid, deal.instalments).instalments.find((i) => i.id === inst.id);
    const amountDue = status ? Math.round((status.amount - status.covered) * 100) / 100 : 0;
    if (!status || amountDue <= 0) {
      nothingToChase.push(inst.id);
      continue;
    }
    const customer = deal.contact ? `${deal.contact.firstName} ${deal.contact.lastName}` : deal.title;
    const entry = byOwner.get(deal.owner.id) ?? { name: deal.owner.name, email: deal.owner.email, rows: [] };
    entry.rows.push({ id: inst.id, customer, dueDate: status.dueDate, amountDue, currency: deal.currency, overdue: status.dueDate < now });
    byOwner.set(deal.owner.id, entry);
  }

  if (nothingToChase.length) {
    await db.instalment.updateMany({ where: { id: { in: nothingToChase }, reminderSentAt: null }, data: { reminderSentAt: now } });
  }

  let emails = 0;
  let failed = 0;
  let instalments = 0;
  for (const { name, email, rows } of byOwner.values()) {
    const mail = instalmentReminderEmail(name, rows);
    // Stamp only after the provider accepted the message, so a failed send is retried next run.
    if (await trySendMail({ to: email, ...mail })) {
      await db.instalment.updateMany({ where: { id: { in: rows.map((r) => r.id) }, reminderSentAt: null }, data: { reminderSentAt: now } });
      emails++;
      instalments += rows.length;
    } else {
      failed++;
    }
  }
  return { instalments, emails, failed };
}
