import { ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { accessOf, PLANS, planOf } from "@/lib/plans";

/**
 * Refuses a create that would take the business past its plan (Phase 4). Counts what the business has now: active
 * users, and contacts that are not deleted. Must run inside the business's context (`authed()` provides it).
 */
export async function assertWithinPlan(tenantId: string, what: "users" | "contacts") {
  const tenant = await db.tenant.findFirst({ where: { id: tenantId }, select: { status: true, plan: true, billingStatus: true, trialEndsAt: true, currentPeriodEnd: true, deletionRequestedAt: true } });
  if (!tenant) return;
  const limit = accessOf(tenant).limits[what];
  if (limit === Infinity) return;
  const used = what === "users" ? await db.user.count({ where: { tenantId, isActive: true } }) : await db.contact.count({ where: { tenantId, deletedAt: null } });
  if (used >= limit) {
    throw new ApiError(403, `The ${PLANS[planOf(tenant.plan)].label} plan allows up to ${limit.toLocaleString("en")} ${what}. Upgrade your plan to add more.`, "PLAN_LIMIT");
  }
}
