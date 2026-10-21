import { db } from "@/lib/db";
import { ApiError, ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { audit } from "@/lib/audit";
import { notFound } from "@/lib/access";
import { contactInclude } from "@/lib/includes";
import { mergeContactSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

/** Fields copied from the removed contact only when the kept contact has nothing there. */
const FILL = ["email", "phone", "phoneE164", "title", "source", "address", "city", "state", "postalCode", "country", "organizationId"] as const;

/**
 * POST /api/contacts/:id/merge { intoId } (admins): folds the contact in the URL into `intoId`.
 * Deals, activities, tasks and tags move over; empty fields on the kept contact are filled from the removed
 * one; the removed contact is soft-deleted (restorable, though the moved records stay with the kept one).
 * The audit log keeps what moved.
 */
export const POST = authed<{ id: string }>(async ({ req, user, params }) => {
  const { intoId } = await readBody(req, mergeContactSchema);
  if (intoId === params.id) throw new ApiError(422, "Pick a different contact to merge into", "VALIDATION_ERROR", { intoId: ["Choose another contact"] });
  const [from, into] = await Promise.all([
    db.contact.findFirst({ where: { id: params.id, deletedAt: null }, include: { tags: { select: { tagId: true } } } }),
    db.contact.findFirst({ where: { id: intoId, deletedAt: null } }),
  ]);
  if (!from) throw notFound("Contact");
  if (!into) throw notFound("Contact to merge into");

  const fill: Record<string, unknown> = {};
  for (const f of FILL) if (into[f] == null && from[f] != null) fill[f] = from[f];
  if (from.type === "CUSTOMER" && into.type !== "CUSTOMER") Object.assign(fill, { type: "CUSTOMER", leadStatus: null });
  if (from.emailOptOut && !into.emailOptOut) fill.emailOptOut = true;

  const [deals, activities, tasks] = await db.$transaction([
    db.deal.updateMany({ where: { contactId: from.id }, data: { contactId: into.id } }),
    db.activity.updateMany({ where: { contactId: from.id }, data: { contactId: into.id } }),
    db.task.updateMany({ where: { contactId: from.id }, data: { contactId: into.id } }),
    db.contactTag.createMany({ data: from.tags.map((t) => ({ contactId: into.id, tagId: t.tagId })), skipDuplicates: true }),
    db.contactTag.deleteMany({ where: { contactId: from.id } }),
    // Email is unique, so the removed contact lets go of it before the kept one can take it.
    db.contact.update({ where: { id: from.id }, data: { deletedAt: new Date(), email: null } }),
    db.contact.update({ where: { id: into.id }, data: fill }),
  ]);
  const moved = { deals: deals.count, activities: activities.count, tasks: tasks.count, tags: from.tags.length };
  await audit(
    user,
    {
      action: "contact.merged",
      entity: "contact",
      entityId: into.id,
      summary: `${from.firstName} ${from.lastName} into ${into.firstName} ${into.lastName}`,
      data: { removedId: from.id, removedEmail: from.email, moved, filled: Object.keys(fill) },
    },
    req,
  );
  return ok(await db.contact.findUniqueOrThrow({ where: { id: into.id }, include: contactInclude }));
}, "ADMIN");
