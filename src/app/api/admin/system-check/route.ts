import { ApiError, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { jobStatus } from "@/lib/job-runs";
import { rowLevelSecurityWarning } from "@/lib/rls-check";
import { authed } from "@/lib/route";
import { systemChecks } from "@/lib/system-check";
import { DEFAULT_TENANT_ID } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/system-check: is this installation set up as the runbook says? Read-only verdicts, no values or secrets.
 * It describes the platform, not a business, so only the original business's admins may see it; everyone else gets the
 * same 404 as a route that does not exist. Admins only.
 */
export const GET = authed(async ({ user }) => {
  if (user.tenantId !== DEFAULT_TENANT_ID) throw new ApiError(404, "Not found", "NOT_FOUND");
  const [rlsWarning, daily] = await Promise.all([
    rowLevelSecurityWarning(db).catch(() => undefined),
    jobStatus("daily").catch(() => null),
  ]);
  return ok({ checks: systemChecks({ env: process.env, rlsWarning, daily }) });
}, "ADMIN");
