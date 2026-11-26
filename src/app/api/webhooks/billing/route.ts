import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { audit } from "@/lib/audit";
import { webhookThrottle } from "@/lib/rate-limit";
import { noteWebhookRejected } from "@/lib/webhook-stats";
import { applySubscriptionEvent, billingStripe } from "@/lib/billing";
import { applyCreditEvent } from "@/lib/ai/credit-packs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/webhooks/billing: Stripe tells us a business's subscription changed, or that it paid for AI credit (the endpoint must also receive checkout.session.completed and checkout.session.async_payment_succeeded). This is the platform's own Stripe
 * account, not a business's (those are /api/webhooks/stripe/<business>). Public on purpose; the only gate is the
 * signature over the raw body. A 5xx makes Stripe retry, which is safe: applying an event twice changes nothing.
 * Not wrapped in authed().
 */
export async function POST(req: Request) {
  const throttled = await webhookThrottle(req, "billing");
  if (throttled) return throttled;
  const secret = process.env.BILLING_STRIPE_WEBHOOK_SECRET;
  const signature = req.headers.get("stripe-signature");
  if (!secret || !process.env.BILLING_STRIPE_SECRET_KEY) return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = billingStripe().webhooks.constructEvent(await req.text(), signature, secret);
  } catch {
    noteWebhookRejected("billing", "bad_signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  try {
    // A paid AI credit pack (one-time payment) adds credit; every other checkout event falls through to the subscription handler.
    const credit = await applyCreditEvent(event);
    if (credit.outcome !== "ignored") {
      if (credit.outcome === "applied") await audit({ email: "stripe-billing", tenantId: credit.tenantId }, { action: "billing.ai_credit_added", entity: "tenant", entityId: credit.tenantId, summary: event.type, data: { eventId: event.id, amountMicros: credit.amountMicros } });
      if (credit.outcome === "mismatch") console.error("ai credit payment did not match its pack", event.id);
      return NextResponse.json({ received: true, outcome: credit.outcome });
    }
    const { outcome, tenantId } = await applySubscriptionEvent(event);
    if (outcome === "applied") await audit({ email: "stripe-billing", tenantId }, { action: "billing.subscription_updated", entity: "tenant", entityId: tenantId, summary: event.type, data: { eventId: event.id } });
    return NextResponse.json({ received: true, outcome });
  } catch (e) {
    console.error("billing webhook failed", event.id, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
