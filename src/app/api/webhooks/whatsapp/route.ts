import { DEFAULT_TENANT_ID } from "@/lib/tenant";
import { receiveWhatsappWebhook, verifyWhatsappWebhook } from "@/lib/whatsapp-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The original address, kept for the first business so its Meta setup needs no change. Every other business uses
// /api/webhooks/whatsapp/<business>.

/** GET /api/webhooks/whatsapp: Meta's one-time check when you save the webhook URL. */
export const GET = (req: Request) => verifyWhatsappWebhook(req, DEFAULT_TENANT_ID);

/** POST /api/webhooks/whatsapp: Meta tells us a customer wrote. See `receiveWhatsappWebhook`. Not wrapped in authed(). */
export const POST = (req: Request) => receiveWhatsappWebhook(req, DEFAULT_TENANT_ID);
