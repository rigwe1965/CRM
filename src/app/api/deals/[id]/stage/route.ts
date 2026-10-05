import { db } from "@/lib/db";
import { ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { dealInclude } from "@/lib/includes";
import { notFound, ownerScope } from "@/lib/access";
import { dealDto, stageTransition } from "@/lib/deals";
import { dealStageSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

/**
 * POST /api/deals/:id/stage: move a deal through the pipeline.
 * Body: { stage, probability?, lostReason? }. Closing sets closedAt (and probability 100/0);
 * reopening clears closedAt and lostReason.
 */
export const POST = authed<{ id: string }>(async ({ req, user, params }) => {
  const body = await readBody(req, dealStageSchema);
  const existing = await db.deal.findFirst({
    where: { id: params.id, deletedAt: null, ...ownerScope(user) },
    select: { id: true },
  });
  if (!existing) throw notFound("Deal");
  const deal = await db.deal.update({
    where: { id: params.id },
    data: stageTransition(body.stage, { probability: body.probability, lostReason: body.lostReason }),
    include: dealInclude,
  });
  return ok(dealDto(deal));
});
