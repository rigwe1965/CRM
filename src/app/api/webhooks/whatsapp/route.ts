import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { parseInbound, recordInbound, validSignature, whatsappConfigured } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** GET /api/webhooks/whatsapp: Meta's one-time check when you save the webhook URL. Echoes the challenge if the verify token matches. */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!whatsappConfigured() || !token) return new NextResponse("Not configured", { status: 503 });
  if (p.get("hub.mode") === "subscribe" && same(p.get("hub.verify_token") ?? "", token)) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

/**
 * POST /api/webhooks/whatsapp: Meta tells us a customer wrote. Public on purpose (Meta is not signed in); the only
 * gate is the signature over the raw body, checked before anything is read. Not wrapped in authed(). A 5xx makes
 * Meta retry, which is safe: each message id is recorded once.
 */
export async function POST(req: Request) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!whatsappConfigured() || !secret) return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  const raw = await req.text();
  if (!validSignature(raw, req.headers.get("x-hub-signature-256"), secret)) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  try {
    for (const msg of parseInbound(payload)) await recordInbound(msg);
  } catch (e) {
    console.error("[whatsapp] webhook failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not record message" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
