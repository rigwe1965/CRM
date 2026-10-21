import { z } from "zod";
import { ok, readQuery } from "@/lib/api";
import { authed } from "@/lib/route";
import { ownerScope } from "@/lib/access";
import { buildReports } from "@/lib/reports";

export const dynamic = "force-dynamic";

const reportsQuery = z.object({ months: z.coerce.number().int().min(1).max(24).default(12) });

/** GET /api/reports?months=12: revenue by month (per currency), days to pay, best sellers, lead sources. Sales users see only their own data. */
export const GET = authed(async ({ req, user }) => {
  const { months } = readQuery(req, reportsQuery);
  return ok(await buildReports(ownerScope(user), months));
});
