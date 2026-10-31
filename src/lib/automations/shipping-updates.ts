import { db } from "@/lib/db";
import { ownerScope, tenantScope } from "@/lib/access";
import type { SessionUser } from "@/lib/auth-helpers";
import { loadShippingUpdates } from "@/lib/automations/settings";
import { FULFILMENT_LABEL, type FulfilmentStatus } from "@/lib/fulfilment";
import { whatsappConfigured } from "@/lib/whatsapp";
import { sendTemplateMessage } from "@/lib/whatsapp-template-send";

/** OFF: the automation is not on for this step. SENT: the customer was messaged. SKIPPED: it was on but nothing went out (a note says why). */
export type ShippingUpdateResult = "OFF" | "SENT" | "SKIPPED";

/**
 * When an order is marked Shipped or Delivered and the business has switched the automatic update on for that step,
 * sends the chosen approved template to the customer on WhatsApp, only if they agreed to WhatsApp messages. At most
 * once per order and step (moving the status back and forth never repeats it). When it cannot send, a note on the
 * order's timeline says why, so staff can send it by hand. Never throws: a failure here must not undo the status change.
 */
export async function runShippingUpdate(user: SessionUser, deal: { id: string; contactId: string | null }, to: FulfilmentStatus): Promise<ShippingUpdateResult> {
  if (to !== "SHIPPED" && to !== "DELIVERED") return "OFF";
  const step = to === "SHIPPED" ? "shipped" : "delivered";
  const label = FULFILMENT_LABEL[to].toLowerCase();

  const note = (body: string) =>
    db.activity
      .create({ data: { tenantId: user.tenantId, type: "NOTE", subject: `Automatic ${label} update not sent`, body, authorId: user.id, contactId: deal.contactId, dealId: deal.id } })
      .catch((e) => console.error("[shipping-update] note not saved", e instanceof Error ? e.message : e));

  try {
    const config = await loadShippingUpdates(user.tenantId);
    if (!config.enabled || !config[step].enabled || !config[step].templateId) return "OFF";
    if (!deal.contactId) return "SKIPPED";

    const [contact, template] = await Promise.all([
      db.contact.findFirst({
        where: { id: deal.contactId, deletedAt: null, ...ownerScope(user) },
        select: { id: true, firstName: true, lastName: true, phoneE164: true, whatsappOptIn: true },
      }),
      db.whatsappTemplate.findFirst({ where: { id: config[step].templateId, ...tenantScope(user), active: true, status: "APPROVED", supported: true } }),
    ]);
    if (!contact) return "SKIPPED";
    if (!contact.whatsappOptIn || !contact.phoneE164) {
      await note(contact.whatsappOptIn ? "The customer has no WhatsApp-ready phone number." : "The customer has not agreed to WhatsApp messages.");
      return "SKIPPED";
    }
    if (!(await whatsappConfigured(user.tenantId))) {
      await note("WhatsApp is not set up.");
      return "SKIPPED";
    }
    if (!template) {
      await note("The chosen template is no longer approved and switched on (Settings → Templates).");
      return "SKIPPED";
    }

    const subject = `Automatic ${label} update: ${template.name}`;
    const already = await db.activity.findFirst({ where: { tenantId: user.tenantId, dealId: deal.id, type: "WHATSAPP", subject }, select: { id: true } });
    if (already) return "SKIPPED";

    await sendTemplateMessage(user, { ...contact, phoneE164: contact.phoneE164 }, template, { dealId: deal.id, subject });
    return "SENT";
  } catch (e) {
    const reason = e instanceof Error ? e.message : "unknown error";
    console.error("[shipping-update] not sent", deal.id, reason);
    await note(reason);
    return "SKIPPED";
  }
}
