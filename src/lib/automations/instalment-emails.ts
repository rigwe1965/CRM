import type { InstalmentReminderKind, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import type { InstalmentEmailsConfig } from "@/lib/automations/config";
import { loadInstalmentEmails } from "@/lib/automations/settings";
import { customerInstalmentEmail, formatAmount } from "@/lib/email-templates";
import { appUrl, trySendMail } from "@/lib/mail";
import { reminderPayLink } from "@/lib/payment-links";
import { senderFor } from "@/lib/sender";
import { summarize } from "@/lib/payments";
import { assertUnderDailyCap } from "@/lib/usage-limits";
import { sendWhatsAppTemplate, whatsappConfigured } from "@/lib/whatsapp";

export type ReminderChannel = "EMAIL" | "WHATSAPP";
/** Said in a template's last parameter when no pay link can be made, so the line still reads well. */
const NO_PAY_LINK_TEXT = "just reply to this message";

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
  channel: ReminderChannel;
  instalmentId: string;
  kind: InstalmentReminderKind;
  /** The email address, or for WhatsApp the phone number in international form. */
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
const reminderSelect = (test: boolean, channel: ReminderChannel) =>
  ({
    id: true,
    dueDate: true,
    reminders: { where: { test, channel }, select: { kind: true, sentAt: true } },
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
        contact: { select: { firstName: true, lastName: true, email: true, emailOptOut: true, phoneE164: true, whatsappOptIn: true, deletedAt: true } },
        payments: { select: { amount: true } },
        instalments: { select: { id: true, position: true, dueDate: true, amount: true } },
      },
    },
  }) satisfies Prisma.InstalmentSelect;
type Row = Prisma.InstalmentGetPayload<{ select: ReturnType<typeof reminderSelect> }>;
const addressOf = (c: Row["deal"]["contact"], channel: ReminderChannel) => (channel === "EMAIL" ? c?.email : c?.phoneE164) ?? null;

/** What is still unpaid on one instalment once the deal's payments are applied oldest-first. */
function amountDueOf(inst: Row): number {
  const { deal } = inst;
  const paid = deal.payments.reduce((s, p) => s + Number(p.amount), 0);
  const status = summarize(Number(deal.amount), paid, deal.instalments).instalments.find((i) => i.id === inst.id);
  return status ? Math.round((status.amount - status.covered) * 100) / 100 : 0;
}

function toPlanned(inst: Row, kind: InstalmentReminderKind, amountDue: number, today: Date, channel: ReminderChannel = "EMAIL"): PlannedEmail | null {
  const { deal } = inst;
  const to = addressOf(deal.contact, channel);
  if (!to || !deal.contact || !deal.contactId) return null;
  return {
    channel,
    instalmentId: inst.id,
    kind,
    to,
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
export function planInstalmentEmails(tenantId: string, config: InstalmentEmailsConfig, now = new Date()): Promise<PlannedEmail[]> {
  return planReminders(tenantId, config, "EMAIL", now);
}

/** Same as the email plan, for WhatsApp: only customers with a valid number who agreed to WhatsApp messages. */
export function planInstalmentWhatsapps(tenantId: string, config: InstalmentEmailsConfig, now = new Date()): Promise<PlannedEmail[]> {
  return planReminders(tenantId, config, "WHATSAPP", now);
}

async function planReminders(tenantId: string, config: InstalmentEmailsConfig, channel: ReminderChannel, now: Date): Promise<PlannedEmail[]> {
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
        contact: channel === "EMAIL" ? { deletedAt: null, email: { not: null }, emailOptOut: false } : { deletedAt: null, phoneE164: { not: null }, whatsappOptIn: true },
      },
    },
    select: reminderSelect(test, channel),
    orderBy: { dueDate: "asc" },
    take: 500,
  });

  const planned: PlannedEmail[] = [];
  for (const inst of rows) {
    const amountDue = amountDueOf(inst);
    const kind = pickReminder({ dueDate: inst.dueDate, today, amountDue, config, sent: inst.reminders.map((r) => r.kind) });
    const email = kind && toPlanned(inst, kind, amountDue, today, channel);
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
    wording: config.wording[p.kind],
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
        where: { instalmentId_kind_test_channel: { instalmentId: p.instalmentId, kind: p.kind, test, channel: "EMAIL" } },
        create: { tenantId, instalmentId: p.instalmentId, kind: p.kind, test, channel: "EMAIL", recipient: to },
        update: { recipient: to, sentAt: new Date() },
      });
    } else {
      await db.instalmentReminder.create({ data: { tenantId, instalmentId: p.instalmentId, kind: p.kind, test, channel: "EMAIL", recipient: to } });
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

/**
 * The template parameters, in order: {{1}} first name, {{2}} amount, {{3}} due date, {{4}} the pay link (or a
 * short line to reply instead). Every approved template uses these four, so one body fits every notice.
 */
export function whatsappParams(p: Pick<PlannedEmail, "firstName" | "amountDue" | "currency" | "dueDate">, payUrl?: string): string[] {
  return [p.firstName, formatAmount(p.amountDue, p.currency), p.dueDate.toISOString().slice(0, 10), payUrl || NO_PAY_LINK_TEXT];
}

/**
 * WhatsApp copy of sendOne: sends the approved template for the notice, records it per channel, and (live
 * only) logs a WhatsApp activity. Test mode sends the same template to the test number and records nothing
 * on the customer. A failed send records nothing, so the next run retries. A daily-cap refusal propagates.
 */
async function sendOneWhatsapp(
  tenantId: string,
  config: InstalmentEmailsConfig,
  p: PlannedEmail,
  by: { id: string; email: string },
  manual: boolean,
): Promise<{ sent: boolean; tasks: number }> {
  const wa = config.whatsapp;
  const test = config.mode === "TEST";
  const to = test ? wa.testPhone : p.to;
  await assertUnderDailyCap(tenantId, "whatsapp");
  const payUrl = test
    ? PAY_LINK_PREVIEW
    : ((await reminderPayLink({ id: by.id, tenantId, email: by.email }, { id: p.dealId, title: p.dealTitle }, p.amountDue, p.currency, appUrl())) ?? undefined);
  const params = whatsappParams(p, payUrl);
  let messageId: string;
  try {
    messageId = await sendWhatsAppTemplate(tenantId, to, wa.templates[p.kind], wa.language, params);
  } catch (e) {
    console.error("[automation] whatsapp reminder failed", p.instalmentId, e instanceof Error ? e.message : e);
    return { sent: false, tasks: 0 };
  }

  let tasks = 0;
  try {
    const key = { instalmentId: p.instalmentId, kind: p.kind, test, channel: "WHATSAPP" };
    if (manual) {
      await db.instalmentReminder.upsert({
        where: { instalmentId_kind_test_channel: key },
        create: { tenantId, ...key, recipient: to },
        update: { recipient: to, sentAt: new Date() },
      });
    } else {
      await db.instalmentReminder.create({ data: { tenantId, ...key, recipient: to } });
    }
    if (!test) {
      await db.activity.create({
        data: {
          tenantId,
          type: "WHATSAPP",
          direction: "OUT",
          subject: "Payment reminder",
          body: `Payment reminder (${wa.templates[p.kind]}): ${params[1]} due ${params[2]}`,
          externalId: messageId,
          authorId: by.id,
          contactId: p.contactId,
          dealId: p.dealId,
        },
      });
      if (p.kind === "OVERDUE_2" && !manual) tasks = await createCallTask(tenantId, p);
    }
  } catch (e) {
    console.error("[automation] whatsapp reminder bookkeeping failed", p.instalmentId, e);
  }
  return { sent: true, tasks };
}

/** The daily WhatsApp run for one business: sends the reminders due today to customers who opted in. */
export async function runInstalmentWhatsapps(tenantId: string, now = new Date()) {
  const config = await loadInstalmentEmails(tenantId);
  const result = { sent: 0, failed: 0, tasks: 0, test: config.mode === "TEST" };
  if (!config.whatsapp.enabled || !(await whatsappConfigured(tenantId))) return result;

  const plan = (await planInstalmentWhatsapps(tenantId, config, now)).slice(0, EMAIL_RUN_LIMIT);
  for (const p of plan) {
    try {
      const r = await sendOneWhatsapp(tenantId, config, p, { id: p.ownerId, email: "automation" }, false);
      if (r.sent) result.sent++;
      else result.failed++;
      result.tasks += r.tasks;
    } catch (e) {
      // The plan's daily WhatsApp allowance is used up: stop, and the rest go out on the next run.
      if ((e as { code?: string }).code === "USAGE_LIMIT") break;
      throw e;
    }
  }

  if (result.sent || result.failed) {
    await audit(
      { email: "automation", tenantId },
      {
        action: "automation.instalment_whatsapps",
        entity: "deal",
        summary: `${result.sent} sent${result.test ? " (test mode, to the test number)" : ""}, ${result.failed} failed, ${result.tasks} call task${result.tasks === 1 ? "" : "s"}`,
      },
    );
  }
  return result;
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
  channel: ReminderChannel = "EMAIL",
) {
  const { tenantId } = user;
  const config = await loadInstalmentEmails(tenantId);
  const test = config.mode === "TEST";
  const wa = channel === "WHATSAPP";
  if (test && !(wa ? config.whatsapp.testPhone : config.testEmail)) {
    throw new ApiError(422, `Reminders are in test mode and no test ${wa ? "WhatsApp number" : "address"} is set. Set one in Settings → Automations, or switch to Live to message customers.`, "REMINDERS_NOT_LIVE");
  }
  if (wa && !(await whatsappConfigured(tenantId))) throw new ApiError(409, "WhatsApp is not set up for this business yet (Settings → Integrations).", "NOT_CONFIGURED");
  const inst = await db.instalment.findFirst({
    where: { id: instalmentId, dealId, tenantId, deal: { tenantId, deletedAt: null } },
    select: reminderSelect(test, channel),
  });
  if (!inst) throw new ApiError(404, "Instalment not found", "NOT_FOUND");
  const { contact } = inst.deal;
  if (inst.deal.stage === "CLOSED_LOST") throw new ApiError(422, "This deal is lost, so no reminders are sent.", "DEAL_LOST");
  if (wa) {
    if (!contact || contact.deletedAt || !contact.phoneE164) throw new ApiError(422, "This customer has no WhatsApp-ready phone number (international form, +49...).", "NO_PHONE");
    if (!contact.whatsappOptIn) throw new ApiError(422, "This customer has not agreed to WhatsApp messages. Tick it on their contact once they have.", "NOT_OPTED_IN");
  } else {
    if (!contact || contact.deletedAt || !contact.email) throw new ApiError(422, "This customer has no email address.", "NO_EMAIL");
    if (contact.emailOptOut) throw new ApiError(422, "This customer has asked not to receive automatic emails.", "OPTED_OUT");
  }
  const amountDue = amountDueOf(inst);
  if (amountDue <= 0) throw new ApiError(422, "This instalment is already paid.", "NOTHING_DUE");
  if (inst.reminders.some((r) => now.getTime() - r.sentAt.getTime() < MANUAL_RESEND_MS)) {
    throw new ApiError(429, "A reminder for this instalment was sent less than an hour ago.", "RECENTLY_SENT");
  }

  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const late = utcDay(today) - utcDay(inst.dueDate);
  const kind: InstalmentReminderKind = late >= config.secondOverdueDays ? "OVERDUE_2" : late >= config.firstOverdueDays ? "OVERDUE_1" : "UPCOMING";
  const planned = toPlanned(inst, kind, amountDue, today, channel);
  if (!planned) throw new ApiError(422, wa ? "This customer has no WhatsApp-ready phone number." : "This customer has no email address.", wa ? "NO_PHONE" : "NO_EMAIL");

  const by = { id: user.id, email: user.email ?? "" };
  const r = wa ? await sendOneWhatsapp(tenantId, config, planned, by, true) : await sendOne(tenantId, config, planned, by, true);
  if (!r.sent) throw new ApiError(502, `The ${wa ? "WhatsApp message" : "email"} could not be sent. Please try again.`, wa ? "WHATSAPP_ERROR" : "EMAIL_FAILED");
  return { kind, test, channel, to: test ? (wa ? config.whatsapp.testPhone : config.testEmail) : planned.to };
}

/** Reminder emails sent about a deal's instalments, newest first, for the deal's Payments screen. */
export async function reminderHistory(tenantId: string, dealId: string) {
  const rows = await db.instalmentReminder.findMany({
    where: { tenantId, instalment: { tenantId, dealId } },
    orderBy: { sentAt: "desc" },
    take: 50,
    select: { id: true, kind: true, test: true, channel: true, recipient: true, sentAt: true, instalment: { select: { position: true, dueDate: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    test: r.test,
    channel: r.channel,
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
