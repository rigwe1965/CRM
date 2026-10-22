import { db } from "@/lib/db";
import { ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { audit } from "@/lib/audit";
import { notFound, ownerScope } from "@/lib/access";
import { cancelPaymentLink, paymentLinksView } from "@/lib/payment-links";
import { stripeConfigured } from "@/lib/stripe";

export const dynamic = "force-dynamic";

/** DELETE /api/deals/:id/payment-links/:linkId: switch off an open link. 409 if it was paid or already closed. */
export const DELETE = authed<{ id: string; linkId: string }>(async ({ req, user, params }) => {
  const deal = await db.deal.findFirst({ where: { id: params.id, deletedAt: null, ...ownerScope(user) }, select: { id: true } });
  if (!deal) throw notFound("Deal");
  await cancelPaymentLink(user.tenantId, deal.id, params.linkId);
  await audit(user, { action: "payment_link.cancelled", entity: "deal", entityId: deal.id, data: { linkId: params.linkId } }, req);
  return ok({ configured: await stripeConfigured(user.tenantId), links: await paymentLinksView(user.tenantId, deal.id) });
});
