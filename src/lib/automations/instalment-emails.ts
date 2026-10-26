import type { InstalmentReminderKind, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import type { InstalmentEmailsConfig } from "@/lib/automations/config";
import { loadInstalmentEmails } from "@/lib/automations/settings";
import { customerInstalmentEmail } from "@/lib/email-templates";
import { appUrl, trySendMail } from "@/lib/mail";
import { reminderPayLink } from "@/lib/payment-links";
import { senderFor } from "@/lib/sender";
import { summarize } from "@/lib/payments";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Instalments overdue for longer than this are left to people: an ancient debt should not get a robot email. */
export const MAX_OVERDUE_DAYS = 30;
/** Most emails one run sends. */
export const EMAIL_RUN_LIMIT = 200;
/** A person cannot send the same instalment another reminder for this long, so a double click never emails a customer twice. */
export const MANUAL_RESEND_MS = 60 * 60 * 1000;
/** Shown on the button in test-mode emails: nothing is created in Stripe while testing. */
export const PAY_LINK_PREVIEW = "https://example.com/pay-link-preview";

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

/** What the planner and the "send now" button both read about an instalment. */
const reminderSelect = (test: boolean) =>
  ({
    id: true,
    dueDate: true,
    reminders: { where: { test }, select: { kind: true, sentAt: true } },
    deal: {
      select: {
        id: true,
        title: true,
        amount: true,
        currency: true,
        stage: true,
        ownerId: true,
        owner: { select: { email: true } },
        contactId: true,
        contact: { select: { firstName: true, lastName: true, email: true, emailOptOut: true, deletedAt: true } },
        payments: { select: { amount: true } },
        instalments: { select: { id: true, position: true, dueDate: true, amount: true } },
      },
    },
  }) satisfies Prisma.InstalmentSelect;
type Row = Prisma.InstalmentGetPayload<{ select: ReturnType<typeof reminderSelect> }>;

/** What is still unpaid on one instalment once the deal's payments are applied oldest-first. */
function amountDueOf(inst: Row): number {
  const { deal } = inst;
  const paid = deal.payments.reduce((s, p) => s + Number(p.amount), 0);
  const status = summarize(Number(deal.amount), paid, deal.instalments).instalments.find((i) => i.id === inst.id);
  return status ? Math.round((status.amount - status.covered) * 100) / 100 : 0;
}

function toPlanned(inst: Row, kind: InstalmentReminderKind, amountDue: number, today: Date): PlannedEmail | null {
  const { deal } = inst;
  if (!deal.contact?.email || !deal.contactId) return null;
  return {
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
  };
}

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
    select: reminderSelect(test),
    orderBy: { dueDate: "asc" },
    take: 500,
  });

  const planned: PlannedEmail[] = [];
  for (const inst of rows) {
    const amountDue = amountDueOf(inst);
    const kind = pickReminder({ dueDate: inst.dueDate, today, amountDue, config, sent: inst.reminders.map((r) => r.kind) });
    const email = kind && toPlanned(inst, kind, amountDue, today);
    if (email) planned.push(email);
  }
  return planned;
}

/**
 * Emails one planned reminder and records it. Test mode sends to the configured test address (marked [TEST],
 * with who would really have received it) and changes nothing else. Live mode emails the customer with
 * replies going to the deal owner, adds a secure pay link when online payment is set up, logs an Email
 * activity on the contact and deal, and (daily run only) after the second overdue notice creates a "call
 * them" task for the owner. A reminder is recorded only after the provider accepted the message, so a failed
 * send is retried on the next run. `manual` means a person pressed "send now": it may repeat a kind that
 * already went out, so the record is refreshed instead of created.
 */
async function sendOne(
  tenantId: string,
  config: InstalmentEmailsConfig,
  p: PlannedEmail,
  by: { id: string; email: string },
  manual: boolean,
): Promise<{ sent: boolean; tasks: number }> {
  const test = config.mode === "TEST";
  const payUrl = test
    ? PAY_LINK_PREVIEW
    : ((await reminderPayLink({ id: by.id, tenantId, email: by.email }, { id: p.dealId, title: p.dealTitle }, p.amountDue, p.currency, appUrl())) ?? undefined);
  const mail = customerInstalmentEmail({
    brand: config.brandName,
    firstName: p.firstName,
    dealTitle: p.dealTitle,
    amountDue: p.amountDue,
    currency: p.currency,
    dueDate: p.dueDate,
    daysLate: p.daysLate,
    kind: p.kind,
    payUrl,
    testNote: test
      ? `This would have gone to ${p.customerName} <${p.to}>.${p.kind === "OVERDUE_2" && !manual ? " A call task would also be created for the deal owner." : ""} Live emails include a secure pay link when Stripe is connected (the button here is only a placeholder).`
      : undefined,
  });
  const to = test ? config.testEmail : p.to;
  const sent = await trySendMail({
    to,
    subject: test ? `[TEST] ${mail.subject}` : mail.subject,
    text: mail.text,
    html: mail.html,
    replyTo: p.ownerEmail,
    from: await senderFor(tenantId, config.brandName),
  });
  if (!sent) return { sent: false, tasks: 0 };

  let tasks = 0;
  try {
    if (manual) {
      await db.instalmentReminder.upsert({
        where: { instalmentId_kind_test: { instalmentId: p.instalmentId, kind: p.kind, test } },
        create: { tenantId, instalmentId: p.instalmentId, kind: p.kind, test, recipient: to },
        update: { recipient: to, sentAt: new Date() },
      });
    } else {
      await db.instalmentReminder.create({ data: { tenantId, instalmentId: p.instalmentId, kind: p.kind, test, recipient: to } });
    }
    if (!test) {
      await db.activity.create({
        data: { tenantId, type: "EMAIL", subject: mail.subject, body: mail.text, authorId: by.id, contactId: p.contactId, dealId: p.dealId },
      });
      if (p.kind === "OVERDUE_2" && !manual) tasks = await createCallTask(tenantId, p);
    }
  } catch (e) {
    // The email is already out; a bookkeeping failure must not stop the rest of the run.
    console.error("[automation] instalment email bookkeeping failed", p.instalmentId, e);
  }
  return { sent: true, tasks };
}

/** The daily run: every reminder that is due today, for one business. */
export async function runInstalmentEmails(tenantId: string, now = new Date()) {
  const config = await loadInstalmentEmails(tenantId);
  const result = { sent: 0, failed: 0, tasks: 0, test: config.mode === "TEST" };
  if (!config.enabled) return result;

  const test = config.mode === "TEST";
  const plan = (await planInstalmentEmails(tenantId, config, now)).slice(0, EMAIL_RUN_LIMIT);

  for (const p of plan) {
    const r = await sendOne(tenantId, config, p, { id: p.ownerId, email: "automation" }, false);
    if (r.sent) result.sent++;
    else result.failed++;
    result.tasks += r.tasks;
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

/**
 * "Send reminder now" for one instalment, pressed by a person. Works whether or not the daily automation is
 * on, but follows its mode: in test mode the email goes to the test address, never to the customer. Picks the
 * notice from how late the instalment is, respects the customer's email opt-out, and refuses a repeat within
 * an hour. The caller has already checked the user may see the deal.
 */
export async function sendReminderNow(
  user: { id: string; email?: string | null; tenantId: string },
  dealId: string,
  instalmentId: string,
  now = new Date(),
) {
  const { tenantId } = user;
  const config = await loadInstalmentEmails(tenantId);
  const test = config.mode === "TEST";
  if (test && !config.testEmail) {
    throw new ApiError(422, "Reminder emails are in test mode and no test address is set. Set one in Settings → Automations, or switch to Live to email customers.", "REMINDERS_NOT_LIVE");
  }
  const inst = await db.instalment.findFirst({
    where: { id: instalmentId, dealId, tenantId, deal: { tenantId, deletedAt: null } },
    select: reminderSelect(test),
  });
  if (!inst) throw new ApiError(404, "Instalment not found", "NOT_FOUND");
  const { contact } = inst.deal;
  if (inst.deal.stage === "CLOSED_LOST") throw new ApiError(422, "This deal is lost, so no reminders are sent.", "DEAL_LOST");
  if (!contact || contact.deletedAt || !contact.email) throw new ApiError(422, "This customer has no email address.", "NO_EMAIL");
  if (contact.emailOptOut) throw new ApiError(422, "This customer has asked not to receive automatic emails.", "OPTED_OUT");
  const amountDue = amountDueOf(inst);
  if (amountDue <= 0) throw new ApiError(422, "This instalment is already paid.", "NOTHING_DUE");
  if (inst.reminders.some((r) => now.getTime() - r.sentAt.getTime() < MANUAL_RESEND_MS)) {
    throw new ApiError(429, "A reminder for this instalment was sent less than an hour ago.", "RECENTLY_SENT");
  }

  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const late = utcDay(today) - utcDay(inst.dueDate);
  const kind: InstalmentReminderKind = late >= config.secondOverdueDays ? "OVERDUE_2" : late >= config.firstOverdueDays ? "OVERDUE_1" : "UPCOMING";
  const planned = toPlanned(inst, kind, amountDue, today);
  if (!planned) throw new ApiError(422, "This customer has no email address.", "NO_EMAIL");

  const r = await sendOne(tenantId, config, planned, { id: user.id, email: user.email ?? "" }, true);
  if (!r.sent) throw new ApiError(502, "The email could not be sent. Please try again.", "EMAIL_FAILED");
  return { kind, test, to: test ? config.testEmail : planned.to };
}

/** Reminder emails sent about a deal's instalments, newest first, for the deal's Payments screen. */
export async function reminderHistory(tenantId: string, dealId: string) {
  const rows = await db.instalmentReminder.findMany({
    where: { tenantId, instalment: { tenantId, dealId } },
    orderBy: { sentAt: "desc" },
    take: 50,
    select: { id: true, kind: true, test: true, recipient: true, sentAt: true, instalment: { select: { position: true, dueDate: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    test: r.test,
    recipient: r.recipient,
    sentAt: r.sentAt,
    position: r.instalment.position,
    dueDate: r.instalment.dueDate,
  }));
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
