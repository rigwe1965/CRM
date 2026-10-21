import { db } from "@/lib/db";
import { ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { audit } from "@/lib/audit";
import { notFound, ownerScope } from "@/lib/access";
import { createPaymentLink, paymentLinksView } from "@/lib/payment-links";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { createPaymentLinkSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

type P = { id: string };

const visibleDeal = (id: string, user: Parameters<typeof ownerScope>[0]) =>
  db.deal.findFirst({ where: { id, deletedAt: null, ...ownerScope(user) }, select: { id: true, title: true } });

/** GET /api/deals/:id/payment-links: the deal's links (newest first) and whether online payment is set up. */
export const GET = authed<P>(async ({ user, params }) => {
  const deal = await visibleDeal(params.id, user);
  if (!deal) throw notFound("Deal");
  return ok({ configured: stripeConfigured(), links: await paymentLinksView(deal.id) });
});

/**
 * POST /api/deals/:id/payment-links: create a Stripe payment link for part of the balance.
 * Body: { amount?, note? }. Amount defaults to everything still left to collect and can't exceed it
 * (open links count as collected). USD and EUR deals only. 503 PAYMENTS_NOT_CONFIGURED without keys.
 */
export const POST = authed<P>(async ({ req, user, params }) => {
  const body = await readBody(req, createPaymentLinkSchema);
  const deal = await visibleDeal(params.id, user);
  if (!deal) throw notFound("Deal");
  stripe(); // fail fast with a clear 503 before reserving any amount
  const base = (process.env.NEXTAUTH_URL ?? new URL(req.url).origin).replace(/\/$/, "");
  const link = await createPaymentLink(user, deal, body, base);
  await audit(user, { action: "payment_link.created", entity: "deal", entityId: deal.id, summary: `${link.amount} ${link.currency}`, data: { linkId: link.id, amount: Number(link.amount) } }, req);
  return ok({ configured: true, links: await paymentLinksView(deal.id) }, 201);
});
