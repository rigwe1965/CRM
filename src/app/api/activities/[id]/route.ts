import { db } from "@/lib/db";
import { noContent, ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { activityInclude } from "@/lib/includes";
import { assertLinks, authorScope, notFound } from "@/lib/access";
import { updateActivitySchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

type P = { id: string };

/** GET /api/activities/:id */
export const GET = authed<P>(async ({ user, params }) => {
  const activity = await db.activity.findFirst({
    where: { id: params.id, ...authorScope(user) },
    include: activityInclude,
  });
  if (!activity) throw notFound("Activity");
  return ok(activity);
});

/** PATCH /api/activities/:id: only the author (or an admin). */
export const PATCH = authed<P>(async ({ req, user, params }) => {
  const body = await readBody(req, updateActivitySchema);
  const existing = await db.activity.findFirst({
    where: { id: params.id, ...authorScope(user) },
    select: { id: true },
  });
  if (!existing) throw notFound("Activity");
  await assertLinks(user, body);
  // `occurredAt`/`type` are non-nullable columns; the schema never produces null for them.
  const activity = await db.activity.update({ where: { id: params.id }, data: body, include: activityInclude });
  return ok(activity);
});

/** DELETE /api/activities/:id: hard delete (activities are a log, not business records). */
export const DELETE = authed<P>(async ({ user, params }) => {
  const { count } = await db.activity.deleteMany({ where: { id: params.id, ...authorScope(user) } });
  if (count === 0) throw notFound("Activity");
  return noContent();
});
