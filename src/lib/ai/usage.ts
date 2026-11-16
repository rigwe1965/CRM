import { db } from "@/lib/db";
import { costMicros, usd, type TokenUsage } from "@/lib/ai/pricing";
import { platformCharge } from "@/lib/ai/included";
import { afterCall, noticesFor, sendIncludedNotices } from "@/lib/ai/included-notices";

/** A business's spending is counted per calendar month in UTC, so everyone sees the same reset moment. */
export const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
export const nextMonthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

/** Records one model call and returns its estimated cost in micro-dollars. Call inside the business's context. */
export async function recordUsage(input: { tenantId: string; userId?: string | null; conversationId?: string | null; model: string; usage: TokenUsage; /** What the call was for; defaults to CHAT. */ purpose?: "CHAT" | "INBOX" | "TRIAGE" | "DOCUMENT" }) {
  const cost = costMicros(input.model, input.usage);
  // Included AI: when the call ran on the platform key, note it and how much of it came out of bought credit.
  const charge = await platformCharge(input.tenantId, cost);
  await db.aiUsage.create({
    data: {
      tenantId: input.tenantId,
      userId: input.userId ?? null,
      conversationId: input.conversationId ?? null,
      model: input.model,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      cacheReadTokens: input.usage.cacheReadTokens,
      cacheWriteTokens: input.usage.cacheWriteTokens,
      costMicros: cost,
      purpose: input.purpose ?? "CHAT",
      platformKey: charge.platformKey,
      creditMicros: charge.creditMicros,
    },
  });
  // Included AI: tell the admins when this call crossed 80% of the allowance, used it all up, or ran the credit low.
  if (charge.platformKey && charge.before) {
    const after = afterCall(charge.before, cost, charge.creditMicros);
    await sendIncludedNotices(input.tenantId, noticesFor(charge.before, after), after);
  }
  return cost;
}

/** This month's estimated spend split by what it was for, in micro-dollars. */
export async function monthToDateByPurpose(tenantId: string, now = new Date()): Promise<Record<string, number>> {
  const rows = await db.aiUsage.groupBy({ by: ["purpose"], where: { tenantId, createdAt: { gte: monthStart(now) } }, _sum: { costMicros: true } });
  return Object.fromEntries(rows.map((r) => [r.purpose, r._sum.costMicros ?? 0]));
}

/** Estimated spend so far this month, in micro-dollars. */
export async function monthToDateMicros(tenantId: string, now = new Date()): Promise<number> {
  const sum = await db.aiUsage.aggregate({ where: { tenantId, createdAt: { gte: monthStart(now) } }, _sum: { costMicros: true } });
  return sum._sum.costMicros ?? 0;
}

export type CeilingLevel = "unset" | "ok" | "warn" | "reached";

/** From 80% of the ceiling the admin is warned; at 100% AI stops until the month turns or the ceiling is raised. */
export const WARN_AT = 0.8;

export function ceilingState(ceilingUsd: number | null, spentMicros: number) {
  const spentUsd = usd(spentMicros);
  if (ceilingUsd === null) return { level: "unset" as CeilingLevel, spentUsd, ceilingUsd: null, percent: null };
  const ceilingMicros = Math.round(ceilingUsd * 1_000_000);
  const level: CeilingLevel = spentMicros >= ceilingMicros ? "reached" : spentMicros >= ceilingMicros * WARN_AT ? "warn" : "ok";
  return { level, spentUsd, ceilingUsd, percent: Math.floor((spentMicros / ceilingMicros) * 100) };
}
