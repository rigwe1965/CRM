import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { audit } from "@/lib/audit";
import { applySubscriptionEvent, billingStripe } from "@/lib/billing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/webhooks/billing: Stripe tells us a business's subscription changed. This is the platform's own Stripe
 * account, not a business's (those are /api/webhooks/stripe/<business>). Public on purpose; the only gate is the
 * signature over the raw body. A 5xx makes Stripe retry, which is safe: applying an event twice changes nothing.
 * Not wrapped in authed().
 */
export async function POST(req: Request) {
  const secret = process.env.BILLING_STRIPE_WEBHOOK_SECRET;
  const signature = req.headers.get("stripe-signature");
  if (!secret || !process.env.BILLING_STRIPE_SECRET_KEY) return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = billingStripe().webhooks.constructEvent(await req.text(), signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  try {
    const { outcome, tenantId } = await applySubscriptionEvent(event);
    if (outcome === "applied") await audit({ email: "stripe-billing", tenantId }, { action: "billing.subscription_updated", entity: "tenant", entityId: tenantId, summary: event.type, data: { eventId: event.id } });
    return NextResponse.json({ received: true, outcome });
  } catch (e) {
    console.error("billing webhook failed", event.id, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
