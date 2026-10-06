import { db } from "@/lib/db";
import { ApiError, noContent, ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { dealInclude } from "@/lib/includes";
import { assertLinks, displayName, notFound, ownerScope, resolveOwner } from "@/lib/access";
import { dealDto, itemsTotal, NO_LEGACY_HAIR, stageTransition } from "@/lib/deals";
import { notifyDealStageChange } from "@/lib/notifications";
import { updateDealSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

type P = { id: string };

/** GET /api/deals/:id (admins can also fetch soft-deleted rows). */
export const GET = authed<P>(async ({ user, params }) => {
  const deal = await db.deal.findFirst({
    where: { id: params.id, ...ownerScope(user), ...(user.role === "ADMIN" ? {} : { deletedAt: null }) },
    include: dealInclude,
  });
  if (!deal) throw notFound("Deal");
  return ok(dealDto(deal));
});

/**
 * PATCH /api/deals/:id: partial update. Changing `stage` also resets probability/closedAt/lostReason
 * (same as POST /:id/stage); an explicit `probability` in the same request wins.
 */
export const PATCH = authed<P>(async ({ req, user, params }) => {
  const { items, ...body } = await readBody(req, updateDealSchema);
  const existing = await db.deal.findFirst({
    where: { id: params.id, deletedAt: null, ...ownerScope(user) },
    select: { stage: true },
  });
  if (!existing) throw notFound("Deal");
  if (items?.length) {
    // Don't let the new total drop below what the customer has already paid.
    const { _sum } = await db.payment.aggregate({ where: { dealId: params.id }, _sum: { amount: true } });
    const paid = Number(_sum.amount ?? 0);
    if (itemsTotal(items) < paid) {
      const msg = `Items total less than the ${paid.toFixed(2)} already paid on this deal`;
      throw new ApiError(422, msg, "VALIDATION_ERROR", { items: [msg] });
    }
  }
  await assertLinks(user, { organizationId: body.organizationId, contactId: body.contactId });
  const ownerId = body.ownerId === undefined ? undefined : ((await resolveOwner(user, body.ownerId)) ?? undefined);

  const moving = body.stage !== undefined && body.stage !== existing.stage;
  const transition = moving
    ? stageTransition(body.stage!, { probability: body.probability, lostReason: body.lostReason })
    : {};

  const deal = await db.deal.update({
    where: { id: params.id },
    data: {
      ...body,
      ...(items && {
        items: { deleteMany: {}, create: items.map((i, n) => ({ ...i, position: n + 1 })) },
        ...(items.length > 0 && { ...NO_LEGACY_HAIR, amount: itemsTotal(items) }),
      }),
      ownerId,
      ...transition,
    },
    include: dealInclude,
  });
  if (moving) {
    await notifyDealStageChange({
      deal,
      from: existing.stage,
      to: deal.stage,
      actor: { id: user.id, name: displayName(user) },
    });
  }
  return ok(dealDto(deal));
});

/** DELETE /api/deals/:id: soft delete (admins can restore via POST /restore). */
export const DELETE = authed<P>(async ({ user, params }) => {
  const { count } = await db.deal.updateMany({
    where: { id: params.id, deletedAt: null, ...ownerScope(user) },
    data: { deletedAt: new Date() },
  });
  if (count === 0) throw notFound("Deal");
  return noContent();
});
