import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { auditOnline, recordOnlinePayment } from "@/lib/payment-links";
import { stripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HANDLED = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);

/**
 * POST /api/webhooks/stripe: Stripe tells us a payment link was paid. Public on purpose (Stripe is
 * not signed in); the only gate is the signature, checked against the raw body before anything is
 * read. Not wrapped in authed(). A 5xx makes Stripe retry, which is safe: recording is idempotent.
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers.get("stripe-signature");
  if (!secret) return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await req.text(), signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (!HANDLED.has(event.type)) return NextResponse.json({ received: true });

  try {
    const result = await recordOnlinePayment(event.data.object as Stripe.Checkout.Session);
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
