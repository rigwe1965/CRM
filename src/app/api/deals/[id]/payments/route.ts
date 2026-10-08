import { db } from "@/lib/db";
import { ApiError, ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { audit } from "@/lib/audit";
import { notFound, ownerScope } from "@/lib/access";
import { dealPaymentsView } from "@/lib/payments";
import { createPaymentSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

type P = { id: string };

const visibleDeal = (id: string, user: Parameters<typeof ownerScope>[0]) =>
  db.deal.findFirst({
    where: { id, deletedAt: null, ...ownerScope(user) },
    select: { id: true, amount: true, currency: true },
  });

/** GET /api/deals/:id/payments: payments received, the optional schedule, and the balance. */
export const GET = authed<P>(async ({ user, params }) => {
  const deal = await visibleDeal(params.id, user);
  if (!deal) throw notFound("Deal");
  return ok(await dealPaymentsView(deal));
});

/** POST /api/deals/:id/payments: record a payment. Rejected if it would exceed the deal amount. */
export const POST = authed<P>(async ({ req, user, params }) => {
  const body = await readBody(req, createPaymentSchema);
  const deal = await visibleDeal(params.id, user);
  if (!deal) throw notFound("Deal");

  const locked = await db.$transaction(async (tx) => {
    // Serialises concurrent payments on this deal: without the lock two requests can both read the
    // same total and both pass the balance check.
    await tx.$queryRaw`SELECT id FROM "Deal" WHERE id = ${deal.id} FOR UPDATE`;
    // Read the deal again now that we hold the lock: an edit that committed while we waited could
    // have lowered the amount, and the copy read above would still show the old one.
    const fresh = await tx.deal.findUnique({ where: { id: deal.id }, select: { id: true, amount: true, currency: true, deletedAt: true } });
    if (!fresh || fresh.deletedAt) throw notFound("Deal");
    const { _sum } = await tx.payment.aggregate({ where: { dealId: deal.id }, _sum: { amount: true } });
    const balance = Math.round((Number(fresh.amount) - Number(_sum.amount ?? 0)) * 100) / 100;
    if (body.amount > balance) {
      const msg = `Exceeds the balance of ${balance.toFixed(2)} ${fresh.currency}`;
      throw new ApiError(422, msg, "VALIDATION_ERROR", { amount: [msg] });
    }
    await tx.payment.create({ data: { ...body, dealId: deal.id, recordedById: user.id } });
    return { id: fresh.id, amount: fresh.amount, currency: fresh.currency };
  });
  await audit(user, { action: "payment.recorded", entity: "deal", entityId: deal.id, summary: `${body.amount} ${locked.currency}`, data: body }, req);
  return ok(await dealPaymentsView(locked), 201);
});
