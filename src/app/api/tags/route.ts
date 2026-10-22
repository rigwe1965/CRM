import { db } from "@/lib/db";
import { ApiError, ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { tenantScope } from "@/lib/access";
import { createTagSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

/** GET /api/tags: every tag, by name. */
export const GET = authed(async ({ user }) => ok(await db.tag.findMany({ where: tenantScope(user), orderBy: { name: "asc" }, take: 500 })));

/**
 * POST /api/tags: create a tag. Anyone signed in can add one (so tagging a contact is quick); names are
 * unique ignoring capital letters, and asking for an existing name returns that tag instead of a second one.
 */
export const POST = authed(async ({ req, user }) => {
  const { name } = await readBody(req, createTagSchema);
  const existing = await db.tag.findFirst({ where: { ...tenantScope(user), name: { equals: name, mode: "insensitive" } } });
  if (existing) return ok(existing);
  if ((await db.tag.count({ where: tenantScope(user) })) >= 500) throw new ApiError(422, "There are too many tags. Ask an admin to remove some.", "TOO_MANY_TAGS");
  return ok(await db.tag.create({ data: { ...tenantScope(user), name } }), 201);
});
