import { db } from "@/lib/db";
import { ApiError, ok, readBody, readQuery } from "@/lib/api";
import { authed } from "@/lib/route";
import { tenantScope } from "@/lib/access";
import { createSavedFilterSchema, savedFilterListQuery } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

const LIMIT_PER_LIST = 20;

/** GET /api/saved-filters?entity=contacts: your own saved views, oldest first. Nobody else's are visible. */
export const GET = authed(async ({ req, user }) => {
  const { entity } = readQuery(req, savedFilterListQuery);
  return ok(await db.savedFilter.findMany({ where: { ...tenantScope(user), userId: user.id, entity }, orderBy: { createdAt: "asc" }, take: LIMIT_PER_LIST }));
});

/**
 * POST /api/saved-filters: save the filters currently on a list as a named view. Saving a name you already
 * have replaces that view. At most 20 per list.
 */
export const POST = authed(async ({ req, user }) => {
  const body = await readBody(req, createSavedFilterSchema);
  const key = { userId_entity_name: { userId: user.id, entity: body.entity, name: body.name } };
  const existing = await db.savedFilter.findUnique({ where: key, select: { id: true } });
  if (!existing && (await db.savedFilter.count({ where: { ...tenantScope(user), userId: user.id, entity: body.entity } })) >= LIMIT_PER_LIST) {
    throw new ApiError(422, `You can keep up to ${LIMIT_PER_LIST} saved views. Delete one first.`, "TOO_MANY_VIEWS");
  }
  const saved = await db.savedFilter.upsert({
    where: key,
    create: { ...tenantScope(user), userId: user.id, entity: body.entity, name: body.name, query: body.query },
    update: { query: body.query },
  });
  return ok(saved, existing ? 200 : 201);
});
