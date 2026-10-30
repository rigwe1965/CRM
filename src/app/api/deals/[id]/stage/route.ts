import { ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { changeDealStage } from "@/lib/crm-actions";
import { dealStageSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

/**
 * POST /api/deals/:id/stage: move a deal through the pipeline.
 * Body: { stage, probability?, lostReason? }. Closing sets closedAt (and probability 100/0);
 * reopening clears closedAt and lostReason.
 */
export const POST = authed<{ id: string }>(async ({ req, user, params }) => {
  const body = await readBody(req, dealStageSchema);
  return ok(await changeDealStage(user, params.id, body));
});
