import { db } from "@/lib/db";
import { ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { notFound, ownerScope } from "@/lib/access";
import { dealPaymentsView } from "@/lib/payments";

export const dynamic = "force-dynamic";

/** DELETE /api/deals/:id/payments/:paymentId: remove a mistaken payment. Returns the updated view. */
export const DELETE = authed<{ id: string; paymentId: string }>(async ({ user, params }) => {
  const deal = await db.deal.findFirst({
    where: { id: params.id, deletedAt: null, ...ownerScope(user) },
    select: { id: true, amount: true, currency: true },
  });
  if (!deal) throw notFound("Deal");
  const { count } = await db.payment.deleteMany({ where: { id: params.paymentId, dealId: deal.id } });
  if (count === 0) throw notFound("Payment");
  return ok(await dealPaymentsView(deal));
});
