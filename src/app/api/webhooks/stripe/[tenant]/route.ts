import { handleStripeWebhook } from "@/lib/stripe-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/webhooks/stripe/:tenant: Stripe tells us one business's payment link was paid. See `handleStripeWebhook`. Not wrapped in authed(). */
export async function POST(req: Request, ctx: { params: Promise<{ tenant: string }> }) {
  return handleStripeWebhook(req, (await ctx.params).tenant);
}
