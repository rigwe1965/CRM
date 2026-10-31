import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { ownerScope } from "@/lib/access";
import { formatAmount } from "@/lib/email-templates";
import { dealPaymentsView } from "@/lib/payments";
import { createOrderLink, currentOrderLink } from "@/lib/order-links";
import type { Slot } from "@/lib/whatsapp-template-slots";

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
  let deal: { id: string; title: string; amount: unknown; currency: string } | null = null;
  if (slots.some((s) => DEAL_SOURCES.has(s.source))) {
    if (!input.dealId) throw invalid("dealId", "Choose the order this message is about.");
    deal = await db.deal.findFirst({
      where: { id: input.dealId, contactId: contact.id, deletedAt: null, ...ownerScope(user) },
      select: { id: true, title: true, amount: true, currency: true },
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
      default:
        if (TYPED_SOURCES.has(slot.source) && !typed) throw invalid(`values.${i}`, `Fill in “${slot.label}”.`);
        return typed!;
    }
  });
}
