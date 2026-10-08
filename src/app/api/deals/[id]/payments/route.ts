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

  await db.$transaction(async (tx) => {
    // Serialises concurrent payments on this deal: without the lock two requests can both read the
    // same total and both pass the balance check.
    await tx.$queryRaw`SELECT id FROM "Deal" WHERE id = ${deal.id} FOR UPDATE`;
    const { _sum } = await tx.payment.aggregate({ where: { dealId: deal.id }, _sum: { amount: true } });
    const balance = Math.round((Number(deal.amount) - Number(_sum.amount ?? 0)) * 100) / 100;
    if (body.amount > balance) {
      const msg = `Exceeds the balance of ${balance.toFixed(2)} ${deal.currency}`;
      throw new ApiError(422, msg, "VALIDATION_ERROR", { amount: [msg] });
    }
    await tx.payment.create({ data: { ...body, dealId: deal.id, recordedById: user.id } });
  });
  await audit(user, { action: "payment.recorded", entity: "deal", entityId: deal.id, summary: `${body.amount} ${deal.currency}`, data: body }, req);
  return ok(await dealPaymentsView(deal), 201);
});
