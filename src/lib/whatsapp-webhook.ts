import { timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { getIntegration } from "@/lib/integrations";
import { enqueueTriage, processTriage } from "@/lib/ai/triage/run";
import { webhookThrottle } from "@/lib/rate-limit";
import { withTenant } from "@/lib/tenant-context";
import { noteWebhookRejected } from "@/lib/webhook-stats";
import { parseInbound, parseStatuses, recordDeliveryStatus, recordInbound, validSignature } from "@/lib/whatsapp";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Meta's one-time check when a business saves its webhook URL. Echoes the challenge if that business's verify token matches. */
export async function verifyWhatsappWebhook(req: Request, tenantId: string): Promise<Response> {
  const throttled = await webhookThrottle(req, "whatsapp-verify");
  if (throttled) return throttled;
  const p = new URL(req.url).searchParams;
  const found = await getIntegration(tenantId, "WHATSAPP");
  // Not configured answers like a wrong token, so the check can't be used to find which businesses use WhatsApp.
  if (!found) return new NextResponse("Forbidden", { status: 403 });
  if (p.get("hub.mode") === "subscribe" && same(p.get("hub.verify_token") ?? "", found.settings.verifyToken)) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

/**
 * Meta tells us a customer wrote to one business. Public on purpose (Meta is not signed in); the only gate is the
 * signature over the raw body, checked against that business's own app secret before anything is read. The business
 * comes from the webhook address, never from the payload, so a message can only ever be filed under the business
 * whose secret signed it. A 5xx makes Meta retry, which is safe: each message id is recorded once.
 */
export async function receiveWhatsappWebhook(req: Request, tenantId: string): Promise<Response> {
  const throttled = await webhookThrottle(req, "whatsapp");
  if (throttled) return throttled;
  const found = await getIntegration(tenantId, "WHATSAPP");
  const raw = await req.text();
  // An unknown or unconfigured business answers exactly like a bad signature.
  if (!found || !validSignature(raw, req.headers.get("x-hub-signature-256"), found.settings.appSecret)) {
    noteWebhookRejected("whatsapp", found ? "bad_signature" : "not_configured");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const filed: string[] = [];
  try {
    for (const msg of parseInbound(payload)) {
      if ((await withTenant(tenantId, () => recordInbound(tenantId, msg))) === "recorded") filed.push(msg.id);
    }
    // Delivery news about messages we sent (sent, delivered, read, failed).
    for (const update of parseStatuses(payload)) await withTenant(tenantId, () => recordDeliveryStatus(tenantId, update));
  } catch (e) {
    console.error("[whatsapp] webhook failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not record message" }, { status: 500 });
  }

  // Triage (AI, Phase 3c) is extra: it is queued here and done after Meta has its answer, and nothing about it can make this fail.
  if (filed.length > 0) {
    try {
      const queued = await withTenant(tenantId, () => enqueueTriage(tenantId, filed));
      if (queued.length > 0) after(() => withTenant(tenantId, () => processTriage(tenantId, queued)).then(() => undefined, (e) => console.error("[ivy-triage] background run failed", e instanceof Error ? e.message : e)));
    } catch (e) {
      console.error("[ivy-triage] could not queue", e instanceof Error ? e.message : e);
    }
  }
  return NextResponse.json({ received: true });
}
