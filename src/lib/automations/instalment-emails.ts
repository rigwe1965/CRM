import type { InstalmentReminderKind } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { InstalmentEmailsConfig } from "@/lib/automations/config";
import { loadInstalmentEmails } from "@/lib/automations/settings";
import { customerInstalmentEmail } from "@/lib/email-templates";
import { fromWithName, trySendMail } from "@/lib/mail";
import { summarize } from "@/lib/payments";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Instalments overdue for longer than this are left to people: an ancient debt should not get a robot email. */
export const MAX_OVERDUE_DAYS = 30;
/** Most emails one run sends. */
export const EMAIL_RUN_LIMIT = 200;

const RANK: Record<InstalmentReminderKind, number> = { UPCOMING: 1, OVERDUE_1: 2, OVERDUE_2: 3 };
const utcDay = (d: Date) => Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / DAY_MS);

/**
 * Which reminder (if any) an instalment should get today. Due today is not overdue, matching the rest of
 * the CRM. Only the most serious eligible reminder is sent, and nothing at or below a kind that already
 * went out: after a gap in the daily run an instalment jumps straight to the right notice instead of
 * receiving all of them at once, and an earlier notice is never sent after a later one.
 */
export function pickReminder(opts: {
  dueDate: Date;
  today: Date;
  amountDue: number;
  config: Pick<InstalmentEmailsConfig, "daysBefore" | "firstOverdueDays" | "secondOverdueDays">;
  sent: InstalmentReminderKind[];
}): InstalmentReminderKind | null {
  const { dueDate, today, amountDue, config, sent } = opts;
  if (amountDue <= 0) return null;
  const late = utcDay(today) - utcDay(dueDate);
  if (late > MAX_OVERDUE_DAYS) return null;

  let kind: InstalmentReminderKind | null = null;
  if (late >= config.secondOverdueDays) kind = "OVERDUE_2";
  else if (late >= config.firstOverdueDays) kind = "OVERDUE_1";
  else if (late <= 0 && -late <= config.daysBefore) kind = "UPCOMING";
  if (!kind) return null;

  const highestSent = Math.max(0, ...sent.map((k) => RANK[k]));
  return RANK[kind] > highestSent ? kind : null;
}

export type PlannedEmail = {
  instalmentId: string;
  kind: InstalmentReminderKind;
  to: string;
  firstName: string;
  customerName: string;
  dealId: string;
  dealTitle: string;
  contactId: string;
  ownerId: string;
  ownerEmail: string;
  amountDue: number;
  currency: string;
  dueDate: Date;
  daysLate: number;
};

/**
 * Every email that would go out right now, without sending anything (also drives the preview in Settings).
 * Skips lost and deleted deals, inactive owners, deleted contacts, contacts with no email address and
 * contacts who opted out. Test-mode and live reminders are tracked separately.
 */
export async function planInstalmentEmails(tenantId: string, config: InstalmentEmailsConfig, now = new Date()): Promise<PlannedEmail[]> {
  const test = config.mode === "TEST";
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const rows = await db.instalment.findMany({
    where: {
      tenantId,
      dueDate: {
        gte: new Date(today.getTime() - MAX_OVERDUE_DAYS * DAY_MS),
        lt: new Date(today.getTime() + (config.daysBefore + 1) * DAY_MS),
      },
      deal: {
        tenantId,
        deletedAt: null,
        stage: { not: "CLOSED_LOST" },
        owner: { isActive: true },
        contact: { deletedAt: null, email: { not: null }, emailOptOut: false },
      },
    },
    select: {
      id: true,
      dueDate: true,
      reminders: { where: { test }, select: { kind: true } },
      deal: {
        select: {
          id: true,
          title: true,
          amount: true,
          currency: true,
          ownerId: true,
          owner: { select: { email: true } },
          contactId: true,
          contact: { select: { firstName: true, lastName: true, email: true } },
          payments: { select: { amount: true } },
          instalments: { select: { id: true, position: true, dueDate: true, amount: true } },
        },
      },
    },
    orderBy: { dueDate: "asc" },
    take: 500,
  });

  const planned: PlannedEmail[] = [];
  for (const inst of rows) {
    const { deal } = inst;
    if (!deal.contact?.email || !deal.contactId) continue;
    const paid = deal.payments.reduce((s, p) => s + Number(p.amount), 0);
    const status = summarize(Number(deal.amount), paid, deal.instalments).instalments.find((i) => i.id === inst.id);
    if (!status) continue;
    const amountDue = Math.round((status.amount - status.covered) * 100) / 100;
    const kind = pickReminder({ dueDate: inst.dueDate, today, amountDue, config, sent: inst.reminders.map((r) => r.kind) });
    if (!kind) continue;
    planned.push({
      instalmentId: inst.id,
      kind,
      to: deal.contact.email,
      firstName: deal.contact.firstName,
      customerName: `${deal.contact.firstName} ${deal.contact.lastName}`,
      dealId: deal.id,
      dealTitle: deal.title,
      contactId: deal.contactId,
      ownerId: deal.ownerId,
      ownerEmail: deal.owner.email,
      amountDue,
      currency: deal.currency,
      dueDate: inst.dueDate,
      daysLate: Math.max(0, utcDay(today) - utcDay(inst.dueDate)),
    });
  }
  return planned;
}

/**
 * Sends the planned emails. Test mode sends every email to the configured test address (marked [TEST], with
 * who would really have received it) and changes nothing else. Live mode emails the customer with replies
 * going to the deal owner, logs an Email activity on the contact and deal, and after the second overdue
 * notice creates a "call them" task for the owner. A reminder is recorded only after the provider accepted
 * the message, so a failed send is retried on the next run.
 */
export async function runInstalmentEmails(tenantId: string, now = new Date()) {
  const config = await loadInstalmentEmails(tenantId);
  const result = { sent: 0, failed: 0, tasks: 0, test: config.mode === "TEST" };
  if (!config.enabled) return result;

  const test = config.mode === "TEST";
  const plan = (await planInstalmentEmails(tenantId, config, now)).slice(0, EMAIL_RUN_LIMIT);

  for (const p of plan) {
    const mail = customerInstalmentEmail({
      brand: config.brandName,
      firstName: p.firstName,
      dealTitle: p.dealTitle,
      amountDue: p.amountDue,
      currency: p.currency,
      dueDate: p.dueDate,
      daysLate: p.daysLate,
      kind: p.kind,
      testNote: test ? `This would have gone to ${p.customerName} <${p.to}>.${p.kind === "OVERDUE_2" ? " A call task would also be created for the deal owner." : ""}` : undefined,
    });
    const to = test ? config.testEmail : p.to;
    const sent = await trySendMail({
      to,
      subject: test ? `[TEST] ${mail.subject}` : mail.subject,
      text: mail.text,
      html: mail.html,
      replyTo: p.ownerEmail,
      from: fromWithName(config.brandName),
    });
    if (!sent) {
      result.failed++;
      continue;
    }
    result.sent++;
    try {
      await db.instalmentReminder.create({ data: { tenantId, instalmentId: p.instalmentId, kind: p.kind, test, recipient: to } });
      if (test) continue;
      await db.activity.create({
        data: { tenantId, type: "EMAIL", subject: mail.subject, body: mail.text, authorId: p.ownerId, contactId: p.contactId, dealId: p.dealId },
      });
      if (p.kind === "OVERDUE_2") result.tasks += await createCallTask(tenantId, p);
    } catch (e) {
      // The email is already out; a bookkeeping failure must not stop the rest of the run.
      console.error("[automation] instalment email bookkeeping failed", p.instalmentId, e);
    }
  }

  if (result.sent || result.failed) {
    await audit(
      { email: "automation", tenantId },
      {
        action: "automation.instalment_emails",
        entity: "deal",
        summary: `${result.sent} sent${test ? " (test mode, to the test address)" : ""}, ${result.failed} failed, ${result.tasks} call task${result.tasks === 1 ? "" : "s"}`,
      },
    );
  }
  return result;
}

/** One open "call them" task per instalment, for the deal owner. Returns how many were created. */
async function createCallTask(tenantId: string, p: PlannedEmail) {
  const automationKey = `overdue-call:${p.instalmentId}`;
  const open = await db.task.findFirst({ where: { tenantId, automationKey, status: { in: ["TODO", "IN_PROGRESS"] } }, select: { id: true } });
  if (open) return 0;
  await db.task.create({
    data: {
      tenantId,
      title: `Call ${p.customerName}: payment is overdue`.slice(0, 200),
      description: `Two reminder emails have gone out about the instalment of ${p.amountDue} ${p.currency} on "${p.dealTitle}" (due ${p.dueDate.toISOString().slice(0, 10)}). Created automatically.`,
      priority: "HIGH",
      dueDate: new Date(),
      assigneeId: p.ownerId,
      createdById: p.ownerId,
      dealId: p.dealId,
      contactId: p.contactId,
      automationKey,
    },
  });
  return 1;
}
