import { db } from "@/lib/db";
import { noContent, ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { notFound, ownerScope, resolveOwner } from "@/lib/access";
import { updateOrganizationSchema } from "@/lib/validations/crm";
import { organizationInclude } from "@/lib/includes";

export const dynamic = "force-dynamic";

type P = { id: string };

/** GET /api/organizations/:id (admins can also fetch soft-deleted rows). */
export const GET = authed<P>(async ({ user, params }) => {
  const org = await db.organization.findFirst({
    where: { id: params.id, ...ownerScope(user), ...(user.role === "ADMIN" ? {} : { deletedAt: null }) },
    include: organizationInclude,
  });
  if (!org) throw notFound("Organization");
  return ok(org);
});

/** PATCH /api/organizations/:id: partial update; null clears optional fields. */
export const PATCH = authed<P>(async ({ req, user, params }) => {
  const body = await readBody(req, updateOrganizationSchema);
  const existing = await db.organization.findFirst({
    where: { id: params.id, deletedAt: null, ...ownerScope(user) },
    select: { id: true },
  });
  if (!existing) throw notFound("Organization");
  const ownerId = body.ownerId === undefined ? undefined : await resolveOwner(user, body.ownerId);
  const org = await db.organization.update({
    where: { id: params.id },
    data: { ...body, ownerId },
    include: organizationInclude,
  });
  return ok(org);
});

/** DELETE /api/organizations/:id: soft delete (admins can restore via POST /restore). */
export const DELETE = authed<P>(async ({ user, params }) => {
  const { count } = await db.organization.updateMany({
    where: { id: params.id, deletedAt: null, ...ownerScope(user) },
    data: { deletedAt: new Date() },
  });
  if (count === 0) throw notFound("Organization");
  return noContent();
});
