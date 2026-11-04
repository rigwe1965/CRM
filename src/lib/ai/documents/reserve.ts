import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { IVY_MODEL } from "@/lib/ai/pricing";
import { DEFAULT_DOCUMENTS_DAILY_CAP, loadAssistantSettings } from "@/lib/ai/settings";
import { ceilingState, monthToDateMicros } from "@/lib/ai/usage";

/**
 * A document read is paid for after the model answers, so several requests sent at once could each pass the checks
 * before any was counted. Before the call, each one saves a placeholder usage record (a small estimated cost) and checks
 * the day's number and the month's ceiling again with every other call in flight counted. The placeholder is removed
 * once the real usage is recorded, or the call fails.
 */

/** Micro-dollars held for a call in flight (about $0.05; a real read costs under a cent). */
export const RESERVE_MICROS = 50_000;

/** A person who is not an admin may use this share of the day's number, so one user cannot use all of it. */
export const userShare = (cap: number, admin: boolean) => (admin ? cap : Math.max(1, Math.ceil(cap / 2)));

const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Holds a place for one document read. Returns a function that gives it back (safe to call twice). Throws a plain-words ApiError when there is no room. */
export async function reserveDocument(user: { id: string; tenantId: string; role?: string }, now = new Date()): Promise<() => Promise<void>> {
  const row = await db.aiUsage.create({ data: { tenantId: user.tenantId, userId: user.id, model: IVY_MODEL, costMicros: RESERVE_MICROS, purpose: "DOCUMENT" }, select: { id: true } });
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await db.aiUsage.deleteMany({ where: { id: row.id, tenantId: user.tenantId } });
  };
  try {
    const settings = await loadAssistantSettings(user.tenantId);
    const cap = settings.documentsDailyCap ?? DEFAULT_DOCUMENTS_DAILY_CAP;
    const since = startOfDay(now);
    const [today, mineToday, spent] = await Promise.all([
      db.aiUsage.count({ where: { tenantId: user.tenantId, purpose: "DOCUMENT", createdAt: { gte: since } } }),
      db.aiUsage.count({ where: { tenantId: user.tenantId, userId: user.id, purpose: "DOCUMENT", createdAt: { gte: since } } }),
      monthToDateMicros(user.tenantId, now),
    ]);
    if (today > cap) throw new ApiError(429, `Today's limit of ${cap} documents has been reached. Try again tomorrow, or type it in.`, "AI_DOCUMENTS_CAP");
    const share = userShare(cap, user.role === "ADMIN");
    if (mineToday > share) throw new ApiError(429, `You have used your share of today's documents (${share}). Ask an admin, or try again tomorrow.`, "AI_DOCUMENTS_CAP");
    const level = ceilingState(settings.monthlyCeilingUsd, spent).level;
    if (level === "reached" || level === "unset") throw new ApiError(429, "This month's spending limit for AI has been reached.", "AI_CEILING_REACHED");
  } catch (e) {
    await release();
    throw e;
  }
  return release;
}
