import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, paginated, readBody, readQuery } from "@/lib/api";
import { authed } from "@/lib/route";
import { dealInclude } from "@/lib/includes";
import { assertLinks, liveFilter, ownerScope, resolveOwner } from "@/lib/access";
import { dealDto, itemsTotal, NO_LEGACY_HAIR, stageTransition } from "@/lib/deals";
import { paymentSummaries } from "@/lib/payments";
import { createDealSchema, dealListQuery } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

/**
 * GET /api/deals: list deals.
 * Search q on title; filters stage (comma list), organizationId, contactId, ownerId,
 * minAmount/maxAmount, closeAfter/closeBefore (expected close date);
 * sort title|amount|stage|probability|expectedCloseDate|createdAt|updatedAt.
 */
export const GET = authed(async ({ req, user }) => {
  const q = readQuery(req, dealListQuery);
  const where: Prisma.DealWhereInput = {
    AND: [
      liveFilter(user, q.includeDeleted),
      ownerScope(user),
      {
        ...(q.stage && { stage: { in: q.stage } }),
        ...(q.organizationId && { organizationId: q.organizationId }),
        ...(q.contactId && { contactId: q.contactId }),
        ...(q.ownerId && { ownerId: q.ownerId }),
        ...((q.minAmount !== undefined || q.maxAmount !== undefined) && {
          amount: { gte: q.minAmount, lte: q.maxAmount },
        }),
        ...((q.closeAfter || q.closeBefore) && {
          expectedCloseDate: { gte: q.closeAfter, lte: q.closeBefore },
        }),
        ...(q.q && { title: { contains: q.q, mode: "insensitive" } }),
      },
    ],
  };
  const [total, items] = await db.$transaction([
    db.deal.count({ where }),
    db.deal.findMany({
      where,
      include: dealInclude,
      orderBy: [{ [q.sort]: q.order }, { id: "asc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  const payments = await paymentSummaries(items);
  return paginated(items.map((d) => ({ ...dealDto(d), payments: payments.get(d.id) })), total, q.page, q.pageSize);
});

/** POST /api/deals: create. Stage defaults to QUALIFICATION; probability defaults from the stage. */
export const POST = authed(async ({ req, user }) => {
  const { items, ...body } = await readBody(req, createDealSchema);
  await assertLinks(user, { organizationId: body.organizationId, contactId: body.contactId });
  const ownerId = (await resolveOwner(user, body.ownerId)) ?? user.id;
  const { stage, probability, closedAt, lostReason } = stageTransition(body.stage, {
    probability: body.probability,
    lostReason: body.lostReason,
  });
  const deal = await db.deal.create({
    data: {
      ...body,
      ...(items?.length && {
        ...NO_LEGACY_HAIR,
        amount: itemsTotal(items),
        items: { create: items.map((i, n) => ({ ...i, position: n + 1 })) },
      }),
      ownerId,
      stage,
      probability,
      closedAt,
      lostReason,
    },
    include: dealInclude,
  });
  return ok(dealDto(deal), 201);
});
