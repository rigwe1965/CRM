import { db } from "@/lib/db";
import { ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { audit } from "@/lib/audit";
import { notFound, ownerScope } from "@/lib/access";
import { loadInstalmentEmails } from "@/lib/automations/settings";
import { whatsappConfigured } from "@/lib/whatsapp";
import { reminderHistory, sendReminderNow } from "@/lib/automations/instalment-emails";
import { sendReminderSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

type P = { id: string };

const visibleDeal = (id: string, user: Parameters<typeof ownerScope>[0]) =>
  db.deal.findFirst({
    where: { id, deletedAt: null, ...ownerScope(user) },
    select: { id: true, title: true, contact: { select: { email: true, emailOptOut: true, phoneE164: true, whatsappOptIn: true, deletedAt: true } } },
  });

async function view(tenantId: string, deal: NonNullable<Awaited<ReturnType<typeof visibleDeal>>>) {
  const config = await loadInstalmentEmails(tenantId);
  const c = deal.contact;
  return {
    // TEST: emails go to the admin's test address, not the customer. LIVE: to the customer.
    mode: config.mode,
    canEmail: !!c && !c.deletedAt && !!c.email && !c.emailOptOut,
    // The customer agreed to WhatsApp, has a usable number, and the business has WhatsApp set up.
    canWhatsapp: !!c && !c.deletedAt && !!c.phoneE164 && c.whatsappOptIn && (await whatsappConfigured(tenantId)),
    reminders: await reminderHistory(tenantId, deal.id),
  };
}

/** GET /api/deals/:id/reminders: reminders (email and WhatsApp) sent about the deal's instalments (newest first), the sending mode, and whether the customer can be emailed or messaged on WhatsApp. */
export const GET = authed<P>(async ({ user, params }) => {
  const deal = await visibleDeal(params.id, user);
  if (!deal) throw notFound("Deal");
  return ok(await view(user.tenantId, deal));
});

/**
 * POST /api/deals/:id/reminders: send the payment reminder for one instalment now. Body: { instalmentId, channel? } (channel is EMAIL by default, or WHATSAPP).
 * The notice (upcoming, first or second overdue) follows how late it is. In test mode it goes to the test
 * address instead of the customer. 422 for a paid instalment, a lost deal, no email or an opted-out customer;
 * 429 within an hour of the last reminder for it. Returns the updated `{ mode, canEmail, canWhatsapp, reminders }`.
 */
export const POST = authed<P>(async ({ req, user, params }) => {
  const body = await readBody(req, sendReminderSchema);
  const deal = await visibleDeal(params.id, user);
  if (!deal) throw notFound("Deal");
  const sent = await sendReminderNow(user, deal.id, body.instalmentId, new Date(), body.channel);
  await audit(
    user,
    { action: "instalment_reminder.sent", entity: "deal", entityId: deal.id, summary: `${sent.kind} by ${sent.channel === "WHATSAPP" ? "WhatsApp" : "email"}${sent.test ? " (test, to the test address)" : ""}`, data: { instalmentId: body.instalmentId, kind: sent.kind, channel: sent.channel, test: sent.test } },
    req,
  );
  return ok(await view(user.tenantId, deal), 201);
});
