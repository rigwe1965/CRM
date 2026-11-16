import { db } from "@/lib/db";
import { includedAiEmail, type IncludedAiNotice } from "@/lib/email-templates";
import { trySendMail } from "@/lib/mail";
import { senderFor } from "@/lib/sender";

/**
 * The emails about included AI (INCLUDED_AI_PLAN.md, step 4): at 80% of the month's allowance, when it is all used up,
 * and when bought credit runs low. Each is sent to the business's admins at the moment a call crosses the line, so no
 * extra state is stored: a line can only be crossed once per month (allowance) or per purchase (credit).
 */
export const CREDIT_LOW_MICROS = 1_000_000; // $1
/** The same 80% warning line as the spending ceiling (src/lib/ai/usage.ts; not imported, to avoid a cycle). */
const WARN_AT = 0.8;

export type Position = { allowanceMicros: number; allowanceUsedMicros: number; creditMicros: number };

const left = (p: Position) => Math.max(0, p.allowanceMicros - p.allowanceUsedMicros) + p.creditMicros;

/** Which notices a call triggers, from the position just before it and just after it. Pure. */
export function noticesFor(before: Position, after: Position): IncludedAiNotice[] {
  const out: IncludedAiNotice[] = [];
  const line = before.allowanceMicros * WARN_AT;
  if (before.allowanceMicros > 0 && before.allowanceUsedMicros < line && after.allowanceUsedMicros >= line && left(after) > 0) out.push("warn");
  if (left(before) > 0 && left(after) <= 0) out.push("exhausted");
  // Credit is only "low" for a business that actually has some, and not at the same moment everything runs out.
  if (before.creditMicros >= CREDIT_LOW_MICROS && after.creditMicros < CREDIT_LOW_MICROS && left(after) > 0) out.push("credit_low");
  return out;
}

/** The position after a call that cost `cost`, of which `fromCredit` was taken from credit and the rest from the allowance. */
export function afterCall(before: Position, cost: number, fromCredit: number): Position {
  return { allowanceMicros: before.allowanceMicros, allowanceUsedMicros: before.allowanceUsedMicros + (cost - fromCredit), creditMicros: Math.max(0, before.creditMicros - fromCredit) };
}

const monthName = (d: Date) => d.toLocaleString("en", { month: "long", year: "numeric", timeZone: "UTC" });
const nextMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);

/** Emails the admins. Never throws: a notice that cannot be sent must not fail the AI call that triggered it. */
export async function sendIncludedNotices(tenantId: string, kinds: IncludedAiNotice[], after: Position, now = new Date()): Promise<void> {
  if (kinds.length === 0) return;
  try {
    const [admins, tenant] = await Promise.all([
      db.user.findMany({ where: { tenantId, role: "ADMIN", isActive: true }, select: { email: true } }),
      db.tenant.findFirst({ where: { id: tenantId }, select: { name: true, brandName: true } }),
    ]);
    if (admins.length === 0) return;
    const brand = (tenant?.brandName || tenant?.name || "CRM").slice(0, 60);
    const from = await senderFor(tenantId, brand);
    for (const kind of kinds) {
      const mail = includedAiEmail({ brand, kind, month: monthName(now), allowanceUsd: after.allowanceMicros / 1e6, usedUsd: after.allowanceUsedMicros / 1e6, creditUsd: after.creditMicros / 1e6, resetsOn: nextMonth(now) });
      await trySendMail({ to: admins.map((a) => a.email), ...mail, from });
    }
  } catch (e) {
    console.error("[included-ai] notice failed", tenantId, e instanceof Error ? e.message : e);
  }
}
