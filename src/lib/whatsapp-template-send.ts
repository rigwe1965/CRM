import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { ownerScope, tenantScope } from "@/lib/access";
import { sendWhatsAppTemplate } from "@/lib/whatsapp";
import { assertUnderDailyCap } from "@/lib/usage-limits";
import { formatAmount } from "@/lib/email-templates";
import { dealPaymentsView } from "@/lib/payments";
import { createOrderLink, currentOrderLink } from "@/lib/order-links";
import { readSlots, renderBody, type Slot } from "@/lib/whatsapp-template-slots";

type Actor = Parameters<typeof ownerScope>[0];
const DEAL_SOURCES = new Set(["dealTitle", "amountDue", "dueDate", "orderLink"]);
const TYPED_SOURCES = new Set(["manual", "trackingNumber"]);

const invalid = (field: string, message: string) => new ApiError(422, message, "VALIDATION_ERROR", { [field]: [message] });

/**
 * The text for each blank of a template, in order. Customer details come from the contact, order details from the
 * chosen deal (which must be this contact's, and visible to the caller), and "typed" blanks from `typed`.
 * Throws a 422 that names the blank when a value cannot be worked out, so nothing half-filled is ever sent.
 */
export async function resolveSlotValues(
  user: Actor,
  contact: { id: string; firstName: string; lastName: string },
  slots: Slot[],
  input: { dealId?: string; typed?: string[] },
): Promise<string[]> {
  let deal: { id: string; title: string; amount: unknown; currency: string; trackingNumber: string | null } | null = null;
  // A tracking number comes from the order when one is chosen and has it; the order is not required for it (it can be typed).
  const wantsDeal = slots.some((s) => DEAL_SOURCES.has(s.source)) || (!!input.dealId && slots.some((s) => s.source === "trackingNumber"));
  if (wantsDeal) {
    if (!input.dealId) throw invalid("dealId", "Choose the order this message is about.");
    deal = await db.deal.findFirst({
      where: { id: input.dealId, contactId: contact.id, deletedAt: null, ...ownerScope(user) },
      select: { id: true, title: true, amount: true, currency: true, trackingNumber: true },
    });
    if (!deal) throw new ApiError(404, "Order not found", "NOT_FOUND");
  }
  const view = deal && slots.some((s) => s.source === "amountDue" || s.source === "dueDate") ? await dealPaymentsView({ id: deal.id, amount: deal.amount as number, currency: deal.currency }) : null;

  // The customer's order page address: the live link if there is one, otherwise a new link is made (and shows in the order's Payments).
  let orderLink: string | null = null;
  if (deal && slots.some((s) => s.source === "orderLink")) {
    const current = await currentOrderLink(user.tenantId, deal.id);
    orderLink = (current?.status === "ACTIVE" && current.url) || (await createOrderLink(user, deal.id)).url;
    if (!orderLink) throw invalid("dealId", "The customer link could not be made. Open the order's Payments and make a new one.");
  }

  return slots.map((slot, i) => {
    const typed = input.typed?.[i]?.replace(/\s+/g, " ").trim();
    switch (slot.source) {
      case "firstName":
        return contact.firstName;
      case "fullName":
        return `${contact.firstName} ${contact.lastName === "-" ? "" : contact.lastName}`.trim();
      case "orderLink":
        return orderLink!;
      case "dealTitle":
        return deal!.title;
      case "amountDue": {
        const due = view!.summary.nextDue?.amount ?? view!.summary.balance;
        if (!(due > 0)) throw invalid("dealId", "Nothing is owed on this order.");
        return formatAmount(due, view!.currency);
      }
      case "dueDate": {
        const next = view!.summary.nextDue;
        if (!next) throw invalid("dealId", "This order has no unpaid instalment with a due date.");
        return next.dueDate.toISOString().slice(0, 10);
      }
      case "trackingNumber": {
        const value = deal?.trackingNumber ?? typed;
        if (!value) throw invalid(`values.${i}`, `Fill in “${slot.label}”, or save the tracking number on the order first.`);
        return value;
      }
      default:
        if (TYPED_SOURCES.has(slot.source) && !typed) throw invalid(`values.${i}`, `Fill in “${slot.label}”.`);
        return typed!;
    }
  });
}

/**
 * Fills a template for one contact, sends it and logs the filled-in text on their timeline (OUT). Shared by the
 * "send template" button and the automatic shipping updates, so both obey the same rules. The caller has already
 * checked that WhatsApp is set up and that the contact has a number and agreed to WhatsApp. A blank that cannot be
 * filled is a 422 naming it (nothing half-filled is sent); a daily-cap refusal and a Meta refusal (502) propagate.
 */
export async function sendTemplateMessage(
  user: Actor,
  contact: { id: string; firstName: string; lastName: string; phoneE164: string },
  template: { name: string; language: string; body: string; slots: unknown },
  input: { dealId?: string; typed?: string[]; subject?: string },
) {
  const values = await resolveSlotValues(user, contact, readSlots(template.slots, template.body), { dealId: input.dealId, typed: input.typed });
  await assertUnderDailyCap(user.tenantId, "whatsapp");
  let messageId: string;
  try {
    messageId = await sendWhatsAppTemplate(user.tenantId, contact.phoneE164, template.name, template.language, values);
  } catch (e) {
    throw new ApiError(502, e instanceof Error ? e.message : "WhatsApp did not accept the message", "WHATSAPP_ERROR");
  }
  return db.activity.create({
    data: {
      ...tenantScope(user),
      type: "WHATSAPP",
      direction: "OUT",
      subject: input.subject ?? `WhatsApp template: ${template.name}`,
      body: renderBody(template.body, values),
      externalId: messageId,
      authorId: user.id,
      contactId: contact.id,
      dealId: input.dealId,
    },
  });
}
