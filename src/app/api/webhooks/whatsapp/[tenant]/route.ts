import { receiveWhatsappWebhook, verifyWhatsappWebhook } from "@/lib/whatsapp-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ tenant: string }> };

/** GET /api/webhooks/whatsapp/:tenant: Meta's one-time check for one business's webhook. */
export async function GET(req: Request, ctx: Ctx) {
  return verifyWhatsappWebhook(req, (await ctx.params).tenant);
}

/** POST /api/webhooks/whatsapp/:tenant: a customer wrote to one business. See `receiveWhatsappWebhook`. Not wrapped in authed(). */
export async function POST(req: Request, ctx: Ctx) {
  return receiveWhatsappWebhook(req, (await ctx.params).tenant);
}
