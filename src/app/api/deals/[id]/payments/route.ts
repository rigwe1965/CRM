import { db } from "@/lib/db";
import { ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { notFound, ownerScope } from "@/lib/access";
import { dealPaymentsView } from "@/lib/payments";
import { recordPayment } from "@/lib/record-payment";
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
  return ok(await recordPayment(user, params.id, body, { req }), 201);
});
