import { ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { PLANS, planOf } from "@/lib/plans";
import { rateLimit } from "@/lib/rate-limit";

const DAY_MS = 24 * 60 * 60_000;

/**
 * Counts one message the business is about to send and refuses it past the plan's daily cap (Phase 5): contains abuse
 * of the CRM as a mail or WhatsApp relay and what it costs us. Call it just before sending, inside the business's
 * context. The count is a rolling-day bucket in the rate limiter, so with Redis it is exact across servers; without
 * it, it is best-effort per server (see rate-limit.ts).
 */
export async function assertUnderDailyCap(tenantId: string, kind: "emails" | "whatsapp") {
  const t = await db.tenant.findFirst({ where: { id: tenantId }, select: { plan: true } });
  const cap = PLANS[planOf(t?.plan ?? "trial")].daily[kind];
  if (cap === Infinity) return;
  const r = await rateLimit(`usage:${kind}:${tenantId}`, { max: cap, windowMs: DAY_MS });
  if (!r.allowed) {
    throw new ApiError(429, `Your plan allows ${cap.toLocaleString("en")} ${kind === "emails" ? "emails" : "WhatsApp messages"} a day, and today's are used. Try again tomorrow or upgrade your plan.`, "USAGE_LIMIT");
  }
}
