import { NextResponse } from "next/server";
import { captchaConfigured, verifyCaptcha } from "@/lib/captcha";
import { db } from "@/lib/db";
import { clientIp, LIMITS, rateLimit } from "@/lib/rate-limit";
import { withTenant } from "@/lib/tenant-context";
import { allowedOrigins, captureWebLead } from "@/lib/web-lead";
import { webLeadSchema } from "@/lib/validations/crm";

/** CORS for the business's listed websites only. A request with no Origin (a server, curl) is not a browser and has nothing to allow. */
async function cors(req: Request, tenantId: string) {
  const origin = req.headers.get("origin");
  if (!origin) return { ok: true, headers: {} as Record<string, string> };
  const allowed = (await allowedOrigins(tenantId)).includes(origin.replace(/\/$/, ""));
  return {
    ok: allowed,
    headers: allowed
      ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" }
      : ({} as Record<string, string>),
  };
}

const activeBusiness = async (tenantId: string) => !!(await withTenant(tenantId, () => db.tenant.findFirst({ where: { id: tenantId, status: "ACTIVE" }, select: { id: true } })));

export async function leadOptions(req: Request, tenantId: string): Promise<Response> {
  const c = await cors(req, tenantId);
  return new NextResponse(null, { status: c.ok ? 204 : 403, headers: c.headers });
}

/**
 * A business's website contact form: { name, email?, phone?, message?, website }. The business comes from the form's
 * address (/api/public/lead/<business>), which is its public key. Public on purpose (visitors are not signed in), so
 * it defends itself: only that business's listed websites may call it from a browser, a hidden `website` field
 * catches bots, requests are rate limited per address and overall for that business, and the body is size-capped.
 * A bot or a known email gets the same "thanks" as anyone, so the form never reveals who is already a contact.
 */
export async function leadPost(req: Request, tenantId: string): Promise<Response> {
  const c = await cors(req, tenantId);
  const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: c.headers });
  if (!c.ok) return NextResponse.json({ error: "This website is not allowed to send enquiries" }, { status: 403 });
  if (!(await activeBusiness(tenantId))) return reply({ error: "Not found" }, 404);

  // Keys carry the business, so one business's traffic can't use up another's allowance.
  const [mine, all] = await Promise.all([rateLimit(`weblead:${tenantId}:${clientIp(req.headers)}`, LIMITS.webLead), rateLimit(`weblead:${tenantId}:all`, LIMITS.webLeadAll)]);
  if (!mine.allowed || !all.allowed) {
    // The shared cap being hit means real visitors are being refused too: worth noticing in the logs.
    if (!all.allowed) console.warn(`[web-lead] overall hourly limit reached for ${tenantId}: website enquiries are being refused`);
    return NextResponse.json({ error: "Too many enquiries. Please try again later." }, { status: 429, headers: { ...c.headers, "Retry-After": String(Math.max(mine.retryAfter, 1)) } });
  }

  const raw = await req.text();
  if (raw.length > 10_000) return reply({ error: "Message too long" }, 413);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return reply({ error: "Invalid request" }, 400);
  }
  const parsed = webLeadSchema.safeParse(json);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const i of parsed.error.issues) fields[String(i.path[0] ?? "form")] ??= i.message;
    return reply({ error: "Please check the form", fields }, 422);
  }
  if (parsed.data.website) return reply({ ok: true }); // a bot: pretend it worked, save nothing

  // Enforced only when the form sent a token, so forms pasted before the CAPTCHA existed keep working until re-pasted.
  const { captchaToken, ...lead } = parsed.data;
  if (captchaToken !== undefined && captchaConfigured() && !(await verifyCaptcha(captchaToken, clientIp(req.headers)))) {
    return reply({ error: "Please confirm you are not a robot and try again.", code: "CAPTCHA_FAILED" }, 400);
  }

  try {
    await withTenant(tenantId, () => captureWebLead(tenantId, lead));
  } catch (e) {
    console.error("[web-lead] failed", e instanceof Error ? e.message : e);
    return reply({ error: "Sorry, something went wrong. Please try again." }, 500);
  }
  return reply({ ok: true });
}
