import { ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { PLANS, planOf } from "@/lib/plans";
import { rateLimit } from "@/lib/rate-limit";

const DAY_MS = 24 * 60 * 60_000;

/** Most emails the shared sender sends in a day across all non-internal businesses. PLATFORM_DAILY_EMAIL_CAP overrides it. */
export const platformDailyEmailCap = () => (Number(process.env.PLATFORM_DAILY_EMAIL_CAP) > 0 ? Number(process.env.PLATFORM_DAILY_EMAIL_CAP) : 5000);

/**
 * A free-trial business that has not verified its own sending domain may not send free-text emails to its contacts:
 * otherwise a throwaway trial is a way to send anything to anyone from the platform's address. Subscribing or
 * verifying a domain lifts it.
 */
export async function assertCanSendFreeText(tenantId: string) {
  const t = await db.tenant.findFirst({ where: { id: tenantId }, select: { plan: true, senderVerifiedAt: true } });
  if (t && planOf(t.plan) === "trial" && !t.senderVerifiedAt) {
    throw new ApiError(403, "Sending your own emails from the CRM is available once you subscribe or verify your own sending domain (Settings → Business).", "TRIAL_EMAIL_RESTRICTED");
  }
}

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
  // One platform-wide ceiling on mail from the shared sender, so a flood of throwaway trial businesses cannot burn the sender's reputation.
  if (kind === "emails") {
    const platform = await rateLimit("usage:emails:platform", { max: platformDailyEmailCap(), windowMs: DAY_MS });
    if (!platform.allowed) {
      console.warn("[usage] the platform-wide daily email ceiling was reached: outgoing mail is being refused");
      throw new ApiError(429, "Email sending is paused for today. Please try again tomorrow.", "USAGE_LIMIT");
    }
  }
  const r = await rateLimit(`usage:${kind}:${tenantId}`, { max: cap, windowMs: DAY_MS });
  if (!r.allowed) {
    throw new ApiError(429, `Your plan allows ${cap.toLocaleString("en")} ${kind === "emails" ? "emails" : "WhatsApp messages"} a day, and today's are used. Try again tomorrow or upgrade your plan.`, "USAGE_LIMIT");
  }
}
