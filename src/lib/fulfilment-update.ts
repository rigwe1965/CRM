import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { notFound, ownerScope, tenantScope } from "@/lib/access";
import type { SessionUser } from "@/lib/auth-helpers";
import { dealInclude } from "@/lib/includes";
import { dealDto } from "@/lib/deals";
import { runShippingUpdate, type ShippingUpdateResult } from "@/lib/automations/shipping-updates";
import { canFulfil, FULFILMENT_LABEL, statusColumns, type FulfilmentStatus } from "@/lib/fulfilment";

export type FulfilmentInput = { status?: FulfilmentStatus; carrier?: string | null; trackingNumber?: string | null };

const invalid = (field: string, message: string) => new ApiError(422, message, "VALIDATION_ERROR", { [field]: [message] });

/**
 * Moves a won order along its shipping steps and/or records the carrier and tracking number. Only a won deal can be
 * fulfilled (422 otherwise). A change of status or tracking is written on the contact's and deal's timeline as a note;
 * the audit log line comes from `authed()`. Returns the deal as the deals API shows it, plus `shippingUpdate`: whether an automatic WhatsApp update went out.
 */
export async function updateFulfilment(user: SessionUser, dealId: string, input: FulfilmentInput) {
  const deal = await db.deal.findFirst({
    where: { id: dealId, deletedAt: null, ...ownerScope(user) },
    select: { stage: true, fulfilmentStatus: true, shippedAt: true, deliveredAt: true, carrier: true, trackingNumber: true, contactId: true },
  });
  if (!deal) throw notFound("Deal");
  if (!canFulfil(deal.stage)) throw invalid("status", "Only a won deal can be shipped. Move it to Closed won first.");

  const statusChanged = input.status !== undefined && input.status !== deal.fulfilmentStatus;
  const carrier = input.carrier === undefined ? deal.carrier : input.carrier;
  const trackingNumber = input.trackingNumber === undefined ? deal.trackingNumber : input.trackingNumber;
  const trackingChanged = carrier !== deal.carrier || trackingNumber !== deal.trackingNumber;
  const next = statusChanged ? statusColumns(deal, input.status!) : {};

  const updated = await db.deal.update({
    where: { id: dealId, ...tenantScope(user) },
    data: { ...next, carrier, trackingNumber },
    include: dealInclude,
  });

  if (statusChanged || trackingChanged) {
    const track = [carrier, trackingNumber ? `tracking ${trackingNumber}` : null].filter(Boolean).join(" · ");
    await db.activity.create({
      data: {
        tenantId: user.tenantId,
        type: "NOTE",
        subject: statusChanged ? `Order ${FULFILMENT_LABEL[updated.fulfilmentStatus].toLowerCase()}` : "Tracking updated",
        body: track || null,
        authorId: user.id,
        contactId: deal.contactId,
        dealId,
      },
    });
  }
  // The automatic WhatsApp update (off unless an admin switched it on) follows the status change, never blocks it.
  const shippingUpdate: ShippingUpdateResult = statusChanged ? await runShippingUpdate(user, { id: dealId, contactId: deal.contactId }, updated.fulfilmentStatus) : "OFF";
  return { ...dealDto(updated), shippingUpdate };
}
