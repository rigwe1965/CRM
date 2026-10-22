import { NextResponse } from "next/server";
import { clientIp, LIMITS, rateLimit } from "@/lib/rate-limit";
import { allowedOrigins, captureWebLead } from "@/lib/web-lead";
import { webLeadSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** CORS for the listed websites only. A request with no Origin (a server, curl) is not a browser and has nothing to allow. */
function cors(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return { ok: true, headers: {} as Record<string, string> };
  const allowed = allowedOrigins().includes(origin.replace(/\/$/, ""));
  return {
    ok: allowed,
    headers: allowed
      ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" }
      : ({} as Record<string, string>),
  };
}

export async function OPTIONS(req: Request) {
  const c = cors(req);
  return new NextResponse(null, { status: c.ok ? 204 : 403, headers: c.headers });
}

/**
 * POST /api/public/lead { name, email?, phone?, message?, website }: the website contact form.
 * Public on purpose (visitors are not signed in), so it defends itself: only listed websites (LEAD_FORM_ORIGINS)
 * may call it from a browser, a hidden `website` field catches bots, requests are rate limited per address and
 * overall, and the body is size-capped. A bot or a known email gets the same "thanks" as anyone, so the form
 * never reveals who is already a contact. Not wrapped in authed().
 */
export async function POST(req: Request) {
  const c = cors(req);
  const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: c.headers });
  if (!c.ok) return NextResponse.json({ error: "This website is not allowed to send enquiries" }, { status: 403 });

  const [mine, all] = await Promise.all([rateLimit(`weblead:${clientIp(req.headers)}`, LIMITS.webLead), rateLimit("weblead:all", LIMITS.webLeadAll)]);
  if (!mine.allowed || !all.allowed) {
    // The shared cap being hit means real visitors are being refused too: worth noticing in the logs.
    if (!all.allowed) console.warn("[web-lead] overall hourly limit reached: website enquiries are being refused");
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

  try {
    await captureWebLead(parsed.data);
  } catch (e) {
    console.error("[web-lead] failed", e instanceof Error ? e.message : e);
    return reply({ error: "Sorry, something went wrong. Please try again." }, 500);
  }
  return reply({ ok: true });
}
