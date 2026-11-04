import type { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import type { SessionUser } from "@/lib/auth-helpers";
import { notFound, ownerScope, tenantScope } from "@/lib/access";
import { audit } from "@/lib/audit";
import { dealPaymentsView } from "@/lib/payments";
import type { createPaymentSchema } from "@/lib/validations/crm";

/**
 * Records a payment on a deal the caller can see. The one place this write lives: the deal's payments route and an
 * approved AI proposal (AI_ASSISTANT_PLAN.md, Wave B) both call it, so they cannot drift apart. Rejected if it would
 * exceed the deal's balance. Writes the `payment.recorded` audit entry; pass `req` when the route has one so the generic
 * entry is not added as well. `expectPaid` (an approved AI proposal passes it) is how much the deal had received when the
 * card was made: if that has changed by the time the lock is held, nothing is recorded, so a payment cannot be entered
 * twice. Run inside the business's context.
 */
export async function recordPayment(user: SessionUser, dealId: string, body: z.infer<typeof createPaymentSchema>, opts: { req?: Request; expectPaid?: number } = {}) {
  const deal = await db.deal.findFirst({
    where: { id: dealId, deletedAt: null, ...ownerScope(user) },
    select: { id: true, amount: true, currency: true },
  });
  if (!deal) throw notFound("Deal");

  const locked = await db.$transaction(async (tx) => {
    // Serialises concurrent payments on this deal: without the lock two requests can both read the
    // same total and both pass the balance check.
    await tx.$queryRaw`SELECT id FROM "Deal" WHERE id = ${deal.id} AND "tenantId" = ${user.tenantId} FOR UPDATE`;
    // Read the deal again now that we hold the lock: an edit that committed while we waited could
    // have lowered the amount, and the copy read above would still show the old one.
    const fresh = await tx.deal.findFirst({ where: { id: deal.id, ...tenantScope(user) }, select: { id: true, amount: true, currency: true, deletedAt: true } });
    if (!fresh || fresh.deletedAt) throw notFound("Deal");
    const { _sum } = await tx.payment.aggregate({ where: { dealId: deal.id, ...tenantScope(user) }, _sum: { amount: true } });
    const paid = Number(_sum.amount ?? 0);
    if (opts.expectPaid !== undefined && Math.abs(paid - opts.expectPaid) > 0.004) {
      throw new ApiError(409, `Another payment was recorded on this deal after AI suggested this (${paid.toFixed(2)} ${fresh.currency} has now been received), so nothing was recorded. Check the deal's payments and ask again if needed.`, "AI_PROPOSAL_STALE");
    }
    const balance = Math.round((Number(fresh.amount) - paid) * 100) / 100;
    if (body.amount > balance) {
      const msg = `Exceeds the balance of ${balance.toFixed(2)} ${fresh.currency}`;
      throw new ApiError(422, msg, "VALIDATION_ERROR", { amount: [msg] });
    }
    await tx.payment.create({ data: { ...body, ...tenantScope(user), dealId: deal.id, recordedById: user.id } });
    return { id: fresh.id, amount: fresh.amount, currency: fresh.currency };
  });
  await audit(user, { action: "payment.recorded", entity: "deal", entityId: deal.id, summary: `${body.amount} ${locked.currency}`, data: body }, opts.req);
  return dealPaymentsView(locked);
}
