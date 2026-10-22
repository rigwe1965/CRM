import Stripe from "stripe";
import { ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { accessOf, PAID_PLANS, PLANS, planOf, type PlanKey } from "@/lib/plans";
import { platformDb } from "@/lib/platform-db";
import { appUrl } from "@/lib/mail";

/**
 * What each business pays us (Phase 4 of MULTI_TENANCY_PLAN.md): Stripe Billing on the PLATFORM's own Stripe account.
 * Separate from the business's own Stripe keys (src/lib/integrations.ts), which are how its customers pay it.
 * Needs BILLING_STRIPE_SECRET_KEY, BILLING_STRIPE_WEBHOOK_SECRET and a price id per paid plan (BILLING_PRICE_*).
 */
export const billingConfigured = () => !!process.env.BILLING_STRIPE_SECRET_KEY && !!process.env.BILLING_STRIPE_WEBHOOK_SECRET;

let client: Stripe | undefined;
let clientKey: string | undefined;
export function billingStripe(): Stripe {
  const key = process.env.BILLING_STRIPE_SECRET_KEY;
  if (!key) throw new ApiError(503, "Billing is not set up yet.", "BILLING_NOT_CONFIGURED");
  if (!client || clientKey !== key) {
    client = new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000 });
    clientKey = key;
  }
  return client;
}

const priceOf = (plan: PlanKey) => {
  const env = PLANS[plan].priceEnv;
  return env ? process.env[env] || undefined : undefined;
};
const planForPrice = (priceId: string | undefined): PlanKey | undefined => PAID_PLANS.find((p) => priceId && priceOf(p) === priceId);

const finite = (n: number) => (Number.isFinite(n) ? n : null);

/** The billing screen's data for the caller's business. Must run in its context. */
export async function billingView(tenantId: string) {
  const t = await db.tenant.findFirstOrThrow({
    where: { id: tenantId },
    select: { status: true, plan: true, billingStatus: true, trialEndsAt: true, currentPeriodEnd: true, deletionRequestedAt: true, stripeCustomerId: true },
  });
  const access = accessOf(t);
  const [users, contacts] = await Promise.all([db.user.count({ where: { tenantId, isActive: true } }), db.contact.count({ where: { tenantId, deletedAt: null } })]);
  const now = Date.now();
  return {
    configured: billingConfigured(),
    plan: planOf(t.plan),
    planLabel: PLANS[planOf(t.plan)].label,
    status: t.billingStatus,
    writable: access.writable,
    readOnlyReason: access.reason,
    trialEndsAt: t.trialEndsAt,
    trialDaysLeft: t.billingStatus === "TRIALING" && t.trialEndsAt ? Math.max(0, Math.ceil((t.trialEndsAt.getTime() - now) / 86_400_000)) : null,
    currentPeriodEnd: t.currentPeriodEnd,
    hasSubscription: !!t.stripeCustomerId && t.billingStatus !== "TRIALING",
    limits: { users: finite(access.limits.users), contacts: finite(access.limits.contacts) },
    usage: { users, contacts },
    plans: PAID_PLANS.map((key) => ({
      key,
      label: PLANS[key].label,
      limits: { users: finite(PLANS[key].limits.users), contacts: finite(PLANS[key].limits.contacts) },
      available: !!priceOf(key),
    })),
  };
}

/** A Stripe Checkout page for subscribing to a plan. Creates the business's Stripe customer the first time. */
export async function startCheckout(user: { id: string; tenantId: string; email?: string | null }, plan: (typeof PAID_PLANS)[number]) {
  const price = priceOf(plan);
  if (!billingConfigured() || !price) throw new ApiError(503, "That plan cannot be bought yet.", "BILLING_NOT_CONFIGURED");
  const stripe = billingStripe();
  const t = await platformDb.tenant.findUniqueOrThrow({ where: { id: user.tenantId }, select: { name: true, stripeCustomerId: true, trialEndsAt: true, billingStatus: true } });
  let customer = t.stripeCustomerId;
  if (!customer) {
    // The metadata names our business so the customer can be traced in Stripe; events are matched by the stored id.
    const created = await stripe.customers.create({ name: t.name, email: user.email ?? undefined, metadata: { tenantId: user.tenantId } });
    customer = created.id;
    await platformDb.tenant.update({ where: { id: user.tenantId }, data: { stripeCustomerId: customer } });
  }
  // A trial that is still running is honoured: Stripe starts charging when it would have ended (Stripe needs 48 h of notice).
  const trialEnd =
    t.billingStatus === "TRIALING" && t.trialEndsAt && t.trialEndsAt.getTime() > Date.now() + 2 * 86_400_000 ? Math.floor(t.trialEndsAt.getTime() / 1000) : undefined;
  const base = appUrl();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: user.tenantId,
    line_items: [{ price, quantity: 1 }],
    subscription_data: { metadata: { tenantId: user.tenantId }, ...(trialEnd && { trial_end: trialEnd }) },
    success_url: `${base}/settings?billing=success`,
    cancel_url: `${base}/settings?billing=canceled`,
  });
  if (!session.url) throw new ApiError(502, "Stripe did not return a checkout page. Please try again.", "PAYMENT_PROVIDER_FAILED");
  return session.url;
}

/** Stripe's hosted page where the business updates its card, changes plan or cancels. */
export async function openPortal(tenantId: string) {
  const t = await platformDb.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { stripeCustomerId: true } });
  if (!t.stripeCustomerId) throw new ApiError(409, "There is no subscription to manage yet.", "NO_SUBSCRIPTION");
  const session = await billingStripe().billingPortal.sessions.create({ customer: t.stripeCustomerId, return_url: `${appUrl()}/settings` });
  return session.url;
}

export type Applied = "applied" | "stale" | "unknown_customer" | "ignored";

const STATUS = { trialing: "ACTIVE", active: "ACTIVE", past_due: "PAST_DUE", unpaid: "PAST_DUE", canceled: "CANCELED", incomplete_expired: "CANCELED" } as const;

/**
 * Applies a subscription event to the business that owns the Stripe customer. The business is found by the customer id
 * we stored ourselves, never by anything in the event's metadata. An older event can't undo a newer one.
 */
export async function applySubscriptionEvent(event: Stripe.Event): Promise<{ outcome: Applied; tenantId?: string }> {
  if (!["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) return { outcome: "ignored" };
  const sub = event.data.object as Stripe.Subscription;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const tenant = await platformDb.tenant.findUnique({ where: { stripeCustomerId: customerId }, select: { id: true, plan: true, billingEventAt: true } });
  if (!tenant) return { outcome: "unknown_customer" };
  const at = new Date(event.created * 1000);
  if (tenant.billingEventAt && at <= tenant.billingEventAt) return { outcome: "stale", tenantId: tenant.id };

  const billingStatus = event.type === "customer.subscription.deleted" ? "CANCELED" : STATUS[sub.status as keyof typeof STATUS];
  if (!billingStatus) return { outcome: "ignored", tenantId: tenant.id }; // incomplete, paused: nothing has changed for the business yet
  const item = sub.items.data[0];
  const plan = planForPrice(item?.price.id) ?? (tenant.plan === "trial" ? "starter" : undefined);
  await platformDb.tenant.update({
    where: { id: tenant.id },
    data: {
      billingStatus,
      stripeSubscriptionId: sub.id,
      currentPeriodEnd: item ? new Date(item.current_period_end * 1000) : undefined,
      billingEventAt: at,
      ...(plan && { plan }),
    },
  });
  return { outcome: "applied", tenantId: tenant.id };
}
