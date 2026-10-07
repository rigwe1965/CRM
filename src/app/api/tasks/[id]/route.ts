import { db } from "@/lib/db";
import { noContent, ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { audit } from "@/lib/audit";
import { taskInclude } from "@/lib/includes";
import { assertLinks, notFound, resolveOwner, taskScope } from "@/lib/access";
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
  const existing = await db.task.findFirst({
    where: { AND: [{ id: params.id }, taskScope(user)] },
    select: { completedAt: true, dueDate: true, assigneeId: true },
  });
  if (!existing) throw notFound("Task");
  await assertLinks(user, body);
  const assigneeId =
    body.assigneeId === undefined ? undefined : ((await resolveOwner(user, body.assigneeId)) ?? undefined);

  const completedAt =
    body.status === undefined ? undefined : body.status === "DONE" ? (existing.completedAt ?? new Date()) : null;

  // A new due date (or a new assignee) deserves a fresh reminder.
  const dueChanged =
    body.dueDate !== undefined && (body.dueDate?.getTime() ?? null) !== (existing.dueDate?.getTime() ?? null);
  const reminderSentAt = dueChanged || (assigneeId !== undefined && assigneeId !== existing.assigneeId) ? null : undefined;

  const task = await db.task.update({
    where: { id: params.id },
    data: { ...body, assigneeId, completedAt, reminderSentAt },
    include: taskInclude,
  });
  return ok(task);
});

/** DELETE /api/tasks/:id: hard delete. */
export const DELETE = authed<P>(async ({ req, user, params }) => {
  const snapshot = await db.task.findFirst({ where: { AND: [{ id: params.id }, taskScope(user)] } });
  const { count } = await db.task.deleteMany({ where: { AND: [{ id: params.id }, taskScope(user)] } });
  if (count === 0) throw notFound("Task");
  await audit(user, { action: "task.deleted", entity: "task", entityId: params.id, summary: snapshot?.title, data: snapshot }, req);
  return noContent();
});
