import { ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { tenantScope } from "@/lib/access";
import { reconcileTenant } from "@/lib/reconcile";

export const dynamic = "force-dynamic";

/**
 * GET /api/reports/reconcile: money-consistency findings across the business's live deals (overpaid, instalments or
 * line items that don't add up to the deal, online payments not matched to Stripe, dead payment links). Read-only. Admins only.
 */
export const GET = authed(async ({ user }) => ok(await reconcileTenant(tenantScope(user))), "ADMIN");
