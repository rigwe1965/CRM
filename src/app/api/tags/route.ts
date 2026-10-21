import { db } from "@/lib/db";
import { ApiError, ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { createTagSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

/** GET /api/tags: every tag, by name. */
export const GET = authed(async () => ok(await db.tag.findMany({ orderBy: { name: "asc" }, take: 500 })));

/**
 * POST /api/tags: create a tag. Anyone signed in can add one (so tagging a contact is quick); names are
 * unique ignoring capital letters, and asking for an existing name returns that tag instead of a second one.
 */
export const POST = authed(async ({ req }) => {
  const { name } = await readBody(req, createTagSchema);
  const existing = await db.tag.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (existing) return ok(existing);
  if ((await db.tag.count()) >= 500) throw new ApiError(422, "There are too many tags. Ask an admin to remove some.", "TOO_MANY_TAGS");
  return ok(await db.tag.create({ data: { name } }), 201);
});
