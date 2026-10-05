import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, paginated, readBody, readQuery } from "@/lib/api";
import { authed } from "@/lib/route";
import { taskInclude } from "@/lib/includes";
import { assertLinks, resolveOwner, taskScope } from "@/lib/access";
import { createTaskSchema, taskListQuery } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

/**
 * GET /api/tasks: tasks assigned to or created by you (admins see all).
 * Search q on title; filters status/priority (comma lists), assigneeId, createdById, contactId, dealId,
 * dueAfter/dueBefore, overdue=true (open tasks past due); sort dueDate|priority|status|title|createdAt.
 */
export const GET = authed(async ({ req, user }) => {
  const q = readQuery(req, taskListQuery);
  const where: Prisma.TaskWhereInput = {
    AND: [
      taskScope(user),
      {
        ...(q.status && { status: { in: q.status } }),
        ...(q.priority && { priority: { in: q.priority } }),
        ...(q.assigneeId && { assigneeId: q.assigneeId }),
        ...(q.createdById && { createdById: q.createdById }),
        ...(q.contactId && { contactId: q.contactId }),
        ...(q.dealId && { dealId: q.dealId }),
        ...((q.dueAfter || q.dueBefore) && { dueDate: { gte: q.dueAfter, lte: q.dueBefore } }),
        ...(q.overdue && { dueDate: { lt: new Date() }, status: { in: ["TODO", "IN_PROGRESS"] } }),
        ...(q.q && { title: { contains: q.q, mode: "insensitive" } }),
      },
    ],
  };
  const [total, items] = await db.$transaction([
    db.task.count({ where }),
    db.task.findMany({
      where,
      include: taskInclude,
      // Tasks without a due date sort last when ascending.
      orderBy: [{ [q.sort]: q.sort === "dueDate" ? { sort: q.order, nulls: "last" } : q.order }, { id: "asc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return paginated(items, total, q.page, q.pageSize);
});

/** POST /api/tasks: create. Assignee defaults to the caller; only admins can assign to someone else. */
export const POST = authed(async ({ req, user }) => {
  const body = await readBody(req, createTaskSchema);
  await assertLinks(user, body);
  const assigneeId = (await resolveOwner(user, body.assigneeId)) ?? user.id;
  const task = await db.task.create({
    data: {
      ...body,
      assigneeId,
      createdById: user.id,
      completedAt: body.status === "DONE" ? new Date() : null,
    },
    include: taskInclude,
  });
  return ok(task, 201);
});
