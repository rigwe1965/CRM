import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getIntegration } from "@/lib/integrations";
import { auditOnline, recordOnlinePayment } from "@/lib/payment-links";
import { webhookThrottle } from "@/lib/rate-limit";
import { stripe } from "@/lib/stripe";
import { noteWebhookRejected } from "@/lib/webhook-stats";

const HANDLED = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);

/**
 * A Stripe event for one business's payment links. Public on purpose (Stripe is not signed in); the only gate is
 * the signature, checked against that business's own webhook secret and the raw body before anything is read.
 * A 5xx makes Stripe retry, which is safe: recording is idempotent. The business comes from the webhook address
 * (/api/webhooks/stripe/<business>), never from the event: `recordOnlinePayment` also refuses a payment link that
 * belongs to a different business.
 */
export async function handleStripeWebhook(req: Request, tenantId: string): Promise<Response> {
  const throttled = await webhookThrottle(req, "stripe");
  if (throttled) return throttled;
  const found = await getIntegration(tenantId, "STRIPE");
  const signature = req.headers.get("stripe-signature");
  // An unknown business, one without payments set up, and an unsigned request all look the same, so the answer
  // never reveals which businesses have Stripe connected.
  if (!found || !signature) {
    noteWebhookRejected("stripe", found ? "bad_signature" : "not_configured");
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = (await stripe(tenantId)).webhooks.constructEvent(await req.text(), signature, found.settings.webhookSecret);
  } catch {
    noteWebhookRejected("stripe", "bad_signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (!HANDLED.has(event.type)) return NextResponse.json({ received: true });

  try {
    const result = await recordOnlinePayment(event.data.object as Stripe.Checkout.Session, tenantId);
    if (result.outcome === "recorded") {
      await auditOnline(result.tenantId, "payment.recorded_online", result.dealId, result.summary, { eventId: event.id });
    } else if (result.outcome === "refund_needed") {
      await auditOnline(result.tenantId, "payment.online_refund_needed", result.dealId, result.summary, { eventId: event.id });
    }
    return NextResponse.json({ received: true, outcome: result.outcome });
  } catch (e) {
    console.error("stripe webhook failed", event.id, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
