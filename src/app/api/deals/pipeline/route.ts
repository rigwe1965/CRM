import { ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { ownerScope } from "@/lib/access";
import { pipelineSummary } from "@/lib/deals";

export const dynamic = "force-dynamic";

/** GET /api/deals/pipeline: per-stage count, total and probability-weighted value (scoped to the caller; admins see all). */
export const GET = authed(async ({ user }) => ok(await pipelineSummary(ownerScope(user))));
