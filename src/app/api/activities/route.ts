import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, paginated, readBody, readQuery } from "@/lib/api";
import { authed } from "@/lib/route";
import { activityInclude } from "@/lib/includes";
import { assertLinks, authorScope } from "@/lib/access";
import { activityListQuery, createActivitySchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

/**
 * GET /api/activities: calls, emails, meetings and notes you authored (admins see all).
 * Search q on subject/body; filters type (comma list), contactId, dealId, organizationId, authorId,
 * from/to (occurredAt); sort occurredAt|type|createdAt.
 */
export const GET = authed(async ({ req, user }) => {
  const q = readQuery(req, activityListQuery);
  const where: Prisma.ActivityWhereInput = {
    AND: [
      authorScope(user),
      {
        ...(q.type && { type: { in: q.type } }),
        ...(q.contactId && { contactId: q.contactId }),
        ...(q.dealId && { dealId: q.dealId }),
        ...(q.organizationId && { organizationId: q.organizationId }),
        ...(q.authorId && { authorId: q.authorId }),
        ...((q.from || q.to) && { occurredAt: { gte: q.from, lte: q.to } }),
        ...(q.q && {
          OR: [
            { subject: { contains: q.q, mode: "insensitive" } },
            { body: { contains: q.q, mode: "insensitive" } },
          ],
        }),
      },
    ],
  };
  const [total, items] = await db.$transaction([
    db.activity.count({ where }),
    db.activity.findMany({
      where,
      include: activityInclude,
      orderBy: [{ [q.sort]: q.order }, { id: "asc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return paginated(items, total, q.page, q.pageSize);
});

/** POST /api/activities: log an activity. Author is always the caller; link to a contact/deal/organization you own. */
export const POST = authed(async ({ req, user }) => {
  const body = await readBody(req, createActivitySchema);
  await assertLinks(user, body);
  const activity = await db.activity.create({
    data: { ...body, authorId: user.id },
    include: activityInclude,
  });
  return ok(activity, 201);
});
