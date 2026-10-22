import { ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { billingView } from "@/lib/billing";

export const dynamic = "force-dynamic";

/** GET /api/billing: the business's plan, trial or subscription status, limits and current usage. */
export const GET = authed(async ({ user }) => ok(await billingView(user.tenantId)), "ADMIN");
