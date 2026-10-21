import { db } from "@/lib/db";
import { ApiError, noContent, ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { audit } from "@/lib/audit";
import { updateTagSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

type P = { id: string };

const missing = () => new ApiError(404, "Tag not found", "NOT_FOUND");

/** PATCH /api/tags/:id: rename a tag (admins). 409 if another tag already has that name. */
export const PATCH = authed<P>(async ({ req, params }) => {
  const { name } = await readBody(req, updateTagSchema);
  const clash = await db.tag.findFirst({ where: { name: { equals: name, mode: "insensitive" }, id: { not: params.id } } });
  if (clash) throw new ApiError(409, "A tag with this name already exists", "CONFLICT", { name: ["Already in use"] });
  const { count } = await db.tag.updateMany({ where: { id: params.id }, data: { name } });
  if (count === 0) throw missing();
  return ok(await db.tag.findUniqueOrThrow({ where: { id: params.id } }));
}, "ADMIN");

/** DELETE /api/tags/:id: remove a tag from every contact and delete it (admins). The audit log keeps how many it was on. */
export const DELETE = authed<P>(async ({ req, user, params }) => {
  const tag = await db.tag.findUnique({ where: { id: params.id }, include: { _count: { select: { contacts: true } } } });
  if (!tag) throw missing();
  await db.tag.delete({ where: { id: params.id } });
  await audit(user, { action: "tag.deleted", entity: "tag", entityId: params.id, summary: tag.name, data: { name: tag.name, contacts: tag._count.contacts } }, req);
  return noContent();
}, "ADMIN");
