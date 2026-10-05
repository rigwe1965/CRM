import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, paginated, readBody, readQuery } from "@/lib/api";
import { authed } from "@/lib/route";
import { contactInclude } from "@/lib/includes";
import { assertLinks, liveFilter, ownerScope, resolveOwner } from "@/lib/access";
import { contactListQuery, createContactSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

/**
 * GET /api/contacts: list leads, prospects, customers, etc.
 * Search q on name/email/phone; filters type, leadStatus (comma lists), organizationId, ownerId;
 * sort name|type|leadStatus|createdAt|updatedAt.
 */
export const GET = authed(async ({ req, user }) => {
  const q = readQuery(req, contactListQuery);
  const where: Prisma.ContactWhereInput = {
    AND: [
      liveFilter(user, q.includeDeleted),
      ownerScope(user),
      {
        ...(q.type && { type: { in: q.type } }),
        ...(q.leadStatus && { leadStatus: { in: q.leadStatus } }),
        ...(q.organizationId && { organizationId: q.organizationId }),
        ...(q.ownerId && { ownerId: q.ownerId }),
        ...(q.q && {
          OR: [
            { firstName: { contains: q.q, mode: "insensitive" } },
            { lastName: { contains: q.q, mode: "insensitive" } },
            { email: { contains: q.q, mode: "insensitive" } },
            { phone: { contains: q.q } },
          ],
        }),
      },
    ],
  };
  const orderBy: Prisma.ContactOrderByWithRelationInput[] =
    q.sort === "name"
      ? [{ lastName: q.order }, { firstName: q.order }, { id: "asc" }]
      : [{ [q.sort]: q.order }, { id: "asc" }];

  const [total, items] = await db.$transaction([
    db.contact.count({ where }),
    db.contact.findMany({
      where,
      include: contactInclude,
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return paginated(items, total, q.page, q.pageSize);
});

/** POST /api/contacts: create. Type defaults to LEAD; owner defaults to the caller. */
export const POST = authed(async ({ req, user }) => {
  const body = await readBody(req, createContactSchema);
  await assertLinks(user, { organizationId: body.organizationId });
  const ownerId = await resolveOwner(user, body.ownerId);
  const contact = await db.contact.create({ data: { ...body, ownerId }, include: contactInclude });
  return ok(contact, 201);
});
