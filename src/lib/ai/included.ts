import { ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { getIntegration } from "@/lib/integrations";
import { accessOf, planOf, type PlanKey } from "@/lib/plans";
import { withTenant } from "@/lib/tenant-context";

/**
 * Included AI (INCLUDED_AI_PLAN.md, step 1): a business without its own Anthropic key can use AI on the platform's key,
 * up to the monthly allowance its plan includes plus any credit it has bought. Everything here is OFF until the owner
 * sets INCLUDED_AI_ANTHROPIC_KEY and an allowance for at least one plan, so shipping this changes nothing by itself.
 *
 * Accounting (all in millionths of a US dollar, from the same price table as the spending ceiling):
 *  - A call on the platform key is recorded with platformKey = true and its cost.
 *  - The month's allowance is used first; the part of a call that the allowance cannot cover is charged to credit and
 *    stored on that row as creditMicros. Nothing is ever edited afterwards, so the balance can always be re-added up.
 *  - credit left = everything added (AiCredit) minus creditMicros already charged.
 */

/** The owner's platform key, kept apart from ANTHROPIC_API_KEY (which belongs to the original business). */
/** The calendar month in UTC, the same boundary the spending ceiling uses (src/lib/ai/usage.ts; not imported, to avoid a cycle). */
const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export const platformKey = () => process.env.INCLUDED_AI_ANTHROPIC_KEY?.trim() || null;

const ALLOWANCE_ENV: Partial<Record<PlanKey, string>> = { trial: "INCLUDED_AI_ALLOWANCE_TRIAL", starter: "INCLUDED_AI_ALLOWANCE_STARTER", pro: "INCLUDED_AI_ALLOWANCE_PRO" };

/** US dollars of AI a plan includes each month. 0 (the default, and for any unset or invalid value) means none. */
export function planAllowanceUsd(plan: string): number {
  const name = ALLOWANCE_ENV[planOf(plan)];
  const n = name ? Number(process.env[name]) : 0;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10_000) : 0;
}

export type IncludedBalance = {
  /** Whether the platform key is set and this business may use it (plan includes AI or it has credit, and it is not read-only). */
  eligible: boolean;
  allowanceMicros: number;
  allowanceUsedMicros: number;
  creditMicros: number;
  /** What can still be spent on the platform key right now. */
  leftMicros: number;
};

/** The arithmetic, with no database, so the rules are easy to test. */
export function balanceOf(o: { allowanceMicros: number; allowanceUsedMicros: number; creditAddedMicros: number; creditChargedMicros: number; writable: boolean; keyConfigured: boolean }): IncludedBalance {
  const allowanceLeft = Math.max(0, o.allowanceMicros - o.allowanceUsedMicros);
  const credit = Math.max(0, o.creditAddedMicros - o.creditChargedMicros);
  const left = allowanceLeft + credit;
  return {
    eligible: o.keyConfigured && o.writable && (o.allowanceMicros > 0 || o.creditAddedMicros > 0),
    allowanceMicros: o.allowanceMicros,
    allowanceUsedMicros: o.allowanceUsedMicros,
    creditMicros: credit,
    leftMicros: o.keyConfigured && o.writable ? left : 0,
  };
}

/** How a platform call's cost splits: the allowance first, then credit (never more than the credit there is). */
export function splitCost(costMicros: number, allowanceLeftMicros: number, creditLeftMicros: number) {
  const fromAllowance = Math.min(costMicros, Math.max(0, allowanceLeftMicros));
  const fromCredit = Math.min(costMicros - fromAllowance, Math.max(0, creditLeftMicros));
  return { fromAllowance, fromCredit };
}

/** This business's included-AI position now. Safe to call outside a request. */
export async function includedBalance(tenantId: string, now = new Date()): Promise<IncludedBalance> {
  // No platform key means included AI is off: nothing to look up, and no extra queries for deployments that do not use it.
  if (!platformKey()) return { eligible: false, allowanceMicros: 0, allowanceUsedMicros: 0, creditMicros: 0, leftMicros: 0 };
  return withTenant(tenantId, async () => {
    const tenant = await db.tenant.findFirst({ where: { id: tenantId }, select: { status: true, plan: true, billingStatus: true, trialEndsAt: true, currentPeriodEnd: true, deletionRequestedAt: true } });
    const [month, added, charged] = await Promise.all([
      db.aiUsage.aggregate({ where: { tenantId, platformKey: true, createdAt: { gte: monthStart(now) } }, _sum: { costMicros: true, creditMicros: true } }),
      db.aiCredit.aggregate({ where: { tenantId }, _sum: { amountMicros: true } }),
      db.aiUsage.aggregate({ where: { tenantId, platformKey: true }, _sum: { creditMicros: true } }),
    ]);
    return balanceOf({
      allowanceMicros: tenant ? Math.round(planAllowanceUsd(tenant.plan) * 1_000_000) : 0,
      // The part of this month's platform spend that came out of the allowance, not out of credit.
      allowanceUsedMicros: (month._sum.costMicros ?? 0) - (month._sum.creditMicros ?? 0),
      creditAddedMicros: added._sum.amountMicros ?? 0,
      creditChargedMicros: charged._sum.creditMicros ?? 0,
      writable: tenant ? accessOf(tenant, now).writable : false,
      keyConfigured: platformKey() !== null,
    });
  });
}

export type ResolvedKey =
  | { kind: "own" | "env"; apiKey: string }
  | { kind: "platform"; apiKey: string }
  | { kind: "none"; reason: "no_key" | "included_exhausted" };

/**
 * Which key a business's AI calls use: its own (Settings), the server's for the original business, or the platform's
 * when it has included AI left. The one place that decides, so billing and the call itself cannot disagree.
 */
export async function resolveAiKey(tenantId: string, now = new Date()): Promise<ResolvedKey> {
  const own = await getIntegration(tenantId, "ANTHROPIC");
  if (own) return { kind: own.source === "env" ? "env" : "own", apiKey: own.settings.apiKey };
  const pk = platformKey();
  if (!pk) return { kind: "none", reason: "no_key" };
  const b = await includedBalance(tenantId, now);
  if (!b.eligible) return { kind: "none", reason: "no_key" };
  if (b.leftMicros <= 0) return { kind: "none", reason: "included_exhausted" };
  return { kind: "platform", apiKey: pk };
}

/** True when AI could run for this business now (own key, or included AI with something left). */
export const hasAiKey = async (tenantId: string) => (await resolveAiKey(tenantId)).kind !== "none";

export const notConfiguredError = (reason: "no_key" | "included_exhausted") =>
  reason === "included_exhausted"
    ? new ApiError(402, "The AI included in your plan is used up for this month. An admin can add their own Anthropic key in Settings, or wait until it renews.", "AI_INCLUDED_EXHAUSTED")
    : new ApiError(409, "AI has no Anthropic key yet. An admin can add one in Settings.", "AI_NOT_CONFIGURED");

/**
 * For recordUsage: whether a call that has just finished ran on the platform key, and how its cost splits. Only looks
 * anything up when a platform key is configured at all, so a deployment that does not use included AI pays no extra queries.
 */
export async function platformCharge(tenantId: string, costMicros: number, now = new Date()): Promise<{ platformKey: boolean; creditMicros: number }> {
  if (!platformKey()) return { platformKey: false, creditMicros: 0 };
  if (await getIntegration(tenantId, "ANTHROPIC")) return { platformKey: false, creditMicros: 0 };
  const b = await includedBalance(tenantId, now);
  if (!b.eligible) return { platformKey: false, creditMicros: 0 };
  const { fromCredit } = splitCost(costMicros, Math.max(0, b.allowanceMicros - b.allowanceUsedMicros), b.creditMicros);
  return { platformKey: true, creditMicros: fromCredit };
}
