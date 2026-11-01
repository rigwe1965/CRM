import { db } from "@/lib/db";
import { ApiError, ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { audit } from "@/lib/audit";
import { notFound, ownerScope, tenantScope } from "@/lib/access";
import { dealPaymentsView } from "@/lib/payments";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/deals/:id/payments/:paymentId (admins): remove a mistaken payment. Returns the updated view. The person who
 * records payments cannot also erase them, and a payment confirmed by Stripe cannot be erased at all (it is reversed by a refund).
 */
export const DELETE = authed<{ id: string; paymentId: string }>(async ({ req, user, params }) => {
  const deal = await db.deal.findFirst({
    where: { id: params.id, deletedAt: null, ...ownerScope(user) },
    select: { id: true, amount: true, currency: true },
  });
  if (!deal) throw notFound("Deal");
  const snapshot = await db.payment.findFirst({ where: { id: params.paymentId, dealId: deal.id, ...tenantScope(user) } });
  if (snapshot?.source === "ONLINE") {
    throw new ApiError(409, "This payment was confirmed by Stripe, so it can't be deleted here. Refund it in Stripe instead.", "ONLINE_PAYMENT");
  }
  const { count } = await db.payment.deleteMany({ where: { id: params.paymentId, dealId: deal.id, ...tenantScope(user) } });
  if (count === 0) throw notFound("Payment");
  await audit(user, { action: "payment.deleted", entity: "deal", entityId: deal.id, summary: snapshot ? `${snapshot.amount} ${deal.currency}` : undefined, data: snapshot }, req);
  return ok(await dealPaymentsView(deal));
}, "ADMIN");
