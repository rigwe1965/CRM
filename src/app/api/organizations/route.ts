import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, paginated, readBody, readQuery } from "@/lib/api";
import { authed } from "@/lib/route";
import { organizationInclude } from "@/lib/includes";
import { liveFilter, ownerScope, resolveOwner } from "@/lib/access";
import { createOrganizationSchema, organizationListQuery } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

/** GET /api/organizations: list (search q on name/domain; filters industry, ownerId; sort name|industry|createdAt|updatedAt). */
export const GET = authed(async ({ req, user }) => {
  const q = readQuery(req, organizationListQuery);
  const where: Prisma.OrganizationWhereInput = {
    AND: [
      liveFilter(user, q.includeDeleted),
      ownerScope(user),
      {
        ...(q.industry && { industry: { equals: q.industry, mode: "insensitive" } }),
        ...(q.ownerId && { ownerId: q.ownerId }),
        ...(q.q && {
          OR: [
            { name: { contains: q.q, mode: "insensitive" } },
            { domain: { contains: q.q, mode: "insensitive" } },
          ],
        }),
      },
    ],
  };
  const [total, items] = await db.$transaction([
    db.organization.count({ where }),
    db.organization.findMany({
      where,
      include: organizationInclude,
      orderBy: [{ [q.sort]: q.order }, { id: "asc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return paginated(items, total, q.page, q.pageSize);
});

/** POST /api/organizations: create. Owner defaults to the caller. */
export const POST = authed(async ({ req, user }) => {
  const body = await readBody(req, createOrganizationSchema);
  const ownerId = await resolveOwner(user, body.ownerId);
  const org = await db.organization.create({ data: { ...body, ownerId }, include: organizationInclude });
  return ok(org, 201);
});
