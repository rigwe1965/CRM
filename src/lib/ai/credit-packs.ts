import { Prisma } from "@prisma/client";
import type Stripe from "stripe";
import { ApiError } from "@/lib/api";
import { appUrl } from "@/lib/mail";
import { accessOf } from "@/lib/plans";
import { platformDb } from "@/lib/platform-db";
import { automaticTax, billingConfigured, billingStripe } from "@/lib/billing";
import { platformKey } from "@/lib/ai/included";
import { CREDIT_CURRENCY, packById, type PackId } from "@/lib/ai/credit-pack-table";

/**
 * Prepaid AI credit (INCLUDED_AI_PLAN.md, option D). A business buys a pack with a one-time Stripe payment on the
 * platform's own Stripe account; when Stripe confirms the payment, the credit is added to its ledger (AiCredit), once.
 *
 * The pack table (credit-pack-table.ts) is the only source of how much credit a payment is worth: the amount of credit is
 * never read from anything in the payment event, and the paid amount must match the pack's price or nothing is added.
 */
export { CREDIT_PACKS, PACK_IDS, CREDIT_CURRENCY, packById, type PackId } from "@/lib/ai/credit-pack-table";
const KIND = "ai_credit_pack";

/** The Checkout Session we ask Stripe for. Pure, so the metadata and tax options are easy to test. */
export function creditCheckoutParams(o: { customer: string; tenantId: string; packId: PackId; baseUrl: string }): Stripe.Checkout.SessionCreateParams {
  const pack = packById(o.packId)!;
  const dollars = (pack.creditMicros / 1_000_000).toLocaleString("en", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const metadata = { kind: KIND, tenantId: o.tenantId, packId: pack.id };
  return {
    mode: "payment",
    customer: o.customer,
    client_reference_id: o.tenantId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: CREDIT_CURRENCY,
          unit_amount: pack.priceCents,
          product_data: { name: `AI credit: $${dollars} of AI use`, description: "Prepaid credit for the CRM's AI assistant. Used after your plan's monthly allowance." },
          // Stripe needs this on ad-hoc prices once Stripe Tax is on.
          ...(automaticTax() && { tax_behavior: "exclusive" as const }),
        },
      },
    ],
    metadata,
    payment_intent_data: { metadata },
    ...(automaticTax() && {
      automatic_tax: { enabled: true },
      billing_address_collection: "required" as const,
      tax_id_collection: { enabled: true },
      customer_update: { address: "auto" as const, name: "auto" as const },
    }),
    success_url: `${o.baseUrl}/settings?ai_credit=success`,
    cancel_url: `${o.baseUrl}/settings?ai_credit=canceled`,
  };
}

/** A Stripe Checkout page for buying one credit pack. Creates the business's Stripe customer the first time (as for plans). */
export async function startCreditCheckout(user: { id: string; tenantId: string; email?: string | null }, packId: PackId) {
  if (!billingConfigured()) throw new ApiError(503, "Billing is not set up yet.", "BILLING_NOT_CONFIGURED");
  if (!platformKey()) throw new ApiError(503, "AI credit cannot be bought yet.", "AI_CREDIT_UNAVAILABLE");
  const t = await platformDb.tenant.findUniqueOrThrow({
    where: { id: user.tenantId },
    select: { name: true, stripeCustomerId: true, status: true, plan: true, billingStatus: true, trialEndsAt: true, currentPeriodEnd: true, deletionRequestedAt: true },
  });
  // Credit is only usable by a business that can use the app: a read-only one has to sort out its plan first.
  if (!accessOf(t).writable) throw new ApiError(409, "Choose a plan first: AI credit is for businesses with an active plan.", "AI_CREDIT_PLAN_REQUIRED");
  const stripe = billingStripe();
  let customer = t.stripeCustomerId;
  if (!customer) {
    const created = await stripe.customers.create({ name: t.name, email: user.email ?? undefined, metadata: { tenantId: user.tenantId } });
    customer = created.id;
    await platformDb.tenant.update({ where: { id: user.tenantId }, data: { stripeCustomerId: customer } });
  }
  const session = await stripe.checkout.sessions.create(creditCheckoutParams({ customer, tenantId: user.tenantId, packId, baseUrl: appUrl() }));
  if (!session.url) throw new ApiError(502, "Stripe did not return a checkout page. Please try again.", "PAYMENT_PROVIDER_FAILED");
  return session.url;
}

export type CreditApplied = "applied" | "duplicate" | "ignored" | "unpaid" | "unknown_customer" | "mismatch";

/**
 * Adds a paid pack's credit to the business that owns the Stripe customer. Safe to receive twice: the Checkout Session id is
 * the ledger entry's reference, which is unique per business. A payment is only credited when it is paid, matches the
 * pack's price and currency (before tax), and its customer is the one we stored for the business named in it.
 */
export async function applyCreditEvent(event: Stripe.Event): Promise<{ outcome: CreditApplied; tenantId?: string; amountMicros?: number }> {
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return { outcome: "ignored" };
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.metadata?.kind !== KIND || session.mode !== "payment") return { outcome: "ignored" };
  // A bank debit can complete the session before the money arrives; the later async event carries the credit.
  if (session.payment_status !== "paid") return { outcome: "unpaid" };
  const pack = packById(session.metadata.packId);
  if (!pack) return { outcome: "ignored" };

  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  const tenant = customerId ? await platformDb.tenant.findUnique({ where: { stripeCustomerId: customerId }, select: { id: true } }) : null;
  if (!tenant) return { outcome: "unknown_customer" };
  if (session.metadata.tenantId !== tenant.id) return { outcome: "mismatch", tenantId: tenant.id };
  // The subtotal is what the pack costs before any tax Stripe added on top.
  if (session.amount_subtotal !== pack.priceCents || session.currency !== CREDIT_CURRENCY) return { outcome: "mismatch", tenantId: tenant.id };

  try {
    await platformDb.aiCredit.create({ data: { tenantId: tenant.id, amountMicros: pack.creditMicros, source: "PACK", reference: session.id, note: pack.id } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { outcome: "duplicate", tenantId: tenant.id };
    throw e;
  }
  return { outcome: "applied", tenantId: tenant.id, amountMicros: pack.creditMicros };
}
