import { handleStripeWebhook } from "@/lib/stripe-webhook";
import { DEFAULT_TENANT_ID } from "@/lib/tenant";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/webhooks/stripe: the original address, kept for the first business so its Stripe dashboard needs no
 * change. Every other business uses /api/webhooks/stripe/<business>. Not wrapped in authed().
 */
export const POST = (req: Request) => handleStripeWebhook(req, DEFAULT_TENANT_ID);
