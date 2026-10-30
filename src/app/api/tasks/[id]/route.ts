import { db } from "@/lib/db";
import { noContent, ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { audit } from "@/lib/audit";
import { taskInclude } from "@/lib/includes";
import { notFound, taskScope } from "@/lib/access";
import { updateTask } from "@/lib/crm-actions";
import { updateTaskSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

type P = { id: string };

/** GET /api/tasks/:id */
export const GET = authed<P>(async ({ user, params }) => {
  const task = await db.task.findFirst({
    where: { AND: [{ id: params.id }, taskScope(user)] },
    include: taskInclude,
  });
  if (!task) throw notFound("Task");
  return ok(task);
});

/** PATCH /api/tasks/:id: assignee or creator (or admin). Moving to DONE stamps completedAt; moving out clears it. */
export const PATCH = authed<P>(async ({ req, user, params }) => {
  const body = await readBody(req, updateTaskSchema);
  return ok(await updateTask(user, params.id, body));
});

/** DELETE /api/tasks/:id: hard delete. */
export const DELETE = authed<P>(async ({ req, user, params }) => {
  const snapshot = await db.task.findFirst({ where: { AND: [{ id: params.id }, taskScope(user)] } });
  const { count } = await db.task.deleteMany({ where: { AND: [{ id: params.id }, taskScope(user)] } });
  if (count === 0) throw notFound("Task");
  await audit(user, { action: "task.deleted", entity: "task", entityId: params.id, summary: snapshot?.title, data: snapshot }, req);
  return noContent();
});
