import { db } from "@/lib/db";
import { noContent, ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { assertLinks, assertTags, notFound, ownerScope, resolveOwner, tenantScope } from "@/lib/access";
import { updateContactSchema } from "@/lib/validations/crm";
import { contactInclude } from "@/lib/includes";
import { normalizePhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

type P = { id: string };

/** GET /api/contacts/:id (admins can also fetch soft-deleted rows). */
export const GET = authed<P>(async ({ user, params }) => {
  const contact = await db.contact.findFirst({
    where: { id: params.id, ...ownerScope(user), ...(user.role === "ADMIN" ? {} : { deletedAt: null }) },
    include: contactInclude,
  });
  if (!contact) throw notFound("Contact");
  return ok(contact);
});

/** PATCH /api/contacts/:id: partial update; null clears optional fields. */
export const PATCH = authed<P>(async ({ req, user, params }) => {
  const { tagIds, ...body } = await readBody(req, updateContactSchema);
  const existing = await db.contact.findFirst({
    where: { id: params.id, deletedAt: null, ...ownerScope(user) },
    select: { id: true },
  });
  if (!existing) throw notFound("Contact");
  await assertLinks(user, { organizationId: body.organizationId });
  await assertTags(user, tagIds);
  const ownerId = body.ownerId === undefined ? undefined : await resolveOwner(user, body.ownerId);
  const contact = await db.contact.update({
    where: { id: params.id, ...tenantScope(user) },
    data: {
      ...body,
      ownerId,
      ...(body.phone !== undefined && { phoneE164: normalizePhone(body.phone) }),
      // The list replaces the contact's tags as a whole.
      ...(tagIds !== undefined && { tags: { deleteMany: {}, create: [...new Set(tagIds)].map((tagId) => ({ tenantId: user.tenantId, tagId })) } }),
    },
    include: contactInclude,
  });
  return ok(contact);
});

/** DELETE /api/contacts/:id: soft delete (admins can restore via POST /restore). */
export const DELETE = authed<P>(async ({ user, params }) => {
  const { count } = await db.contact.updateMany({
    where: { id: params.id, deletedAt: null, ...ownerScope(user) },
    data: { deletedAt: new Date() },
  });
  if (count === 0) throw notFound("Contact");
  return noContent();
});
