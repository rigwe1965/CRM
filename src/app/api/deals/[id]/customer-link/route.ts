import { db } from "@/lib/db";
import { ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { notFound, ownerScope } from "@/lib/access";
import { createOrderLink, currentOrderLink, revokeOrderLink } from "@/lib/order-links";
import { createCustomerLinkSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

type P = { id: string };

const visibleDeal = (id: string, user: Parameters<typeof ownerScope>[0]) => db.deal.findFirst({ where: { id, deletedAt: null, ...ownerScope(user) }, select: { id: true } });

/** GET /api/deals/:id/customer-link: the order's newest customer link (or `{ link: null }`) with its address while it is live. */
export const GET = authed<P>(async ({ user, params }) => {
  const deal = await visibleDeal(params.id, user);
  if (!deal) throw notFound("Deal");
  return ok({ link: await currentOrderLink(user.tenantId, deal.id) });
});

/**
 * POST /api/deals/:id/customer-link { expiresInDays? }: makes a new private link for the customer to see this order
 * and revokes the earlier one, so an old link stops working at once. Lasts 90 days unless told otherwise (1 to 365).
 */
export const POST = authed<P>(async ({ req, user, params }) => {
  const body = await readBody(req, createCustomerLinkSchema);
  const deal = await visibleDeal(params.id, user);
  if (!deal) throw notFound("Deal");
  return ok({ link: await createOrderLink(user, deal.id, body.expiresInDays) }, 201);
});

/** DELETE /api/deals/:id/customer-link: switches the customer link off at once. The link stays on record as REVOKED. */
export const DELETE = authed<P>(async ({ user, params }) => {
  const deal = await visibleDeal(params.id, user);
  if (!deal) throw notFound("Deal");
  await revokeOrderLink(user.tenantId, deal.id);
  return ok({ link: await currentOrderLink(user.tenantId, deal.id) });
});
