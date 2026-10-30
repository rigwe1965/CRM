import type { z } from "zod";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth-helpers";
import { assertLinks, displayName, notFound, ownerScope, resolveOwner, taskScope, tenantScope } from "@/lib/access";
import { activityInclude, dealInclude, taskInclude } from "@/lib/includes";
import { dealDto, stageTransition } from "@/lib/deals";
import { notifyDealStageChange } from "@/lib/notifications";
import { runStageAutomations } from "@/lib/automations";
import type { createActivitySchema, createTaskSchema, dealStageSchema, updateTaskSchema } from "@/lib/validations/crm";

/**
 * The writes that both a screen's API route and an approved Ivy proposal run (AI_ASSISTANT_PLAN.md, Phase 2), so the
 * two can never drift apart. Each takes input already validated by its schema and acts as `user`: the caller's scope
 * and business rules are enforced here, not by whoever calls. Run inside the business's context (authed() does).
 */

/** Creates a task. The assignee defaults to the caller; only admins can assign to someone else. */
export async function createTask(user: SessionUser, body: z.infer<typeof createTaskSchema>) {
  await assertLinks(user, body);
  const assigneeId = (await resolveOwner(user, body.assigneeId)) ?? user.id;
  return db.task.create({
    data: {
      ...body,
      ...tenantScope(user),
      assigneeId,
      createdById: user.id,
      completedAt: body.status === "DONE" ? new Date() : null,
    },
    include: taskInclude,
  });
}

/** Changes a task the caller can see. Moving to DONE stamps completedAt; moving out clears it; a new due date or assignee earns a fresh reminder. */
export async function updateTask(user: SessionUser, id: string, body: z.infer<typeof updateTaskSchema>) {
  const existing = await db.task.findFirst({
    where: { AND: [{ id }, taskScope(user)] },
    select: { completedAt: true, dueDate: true, assigneeId: true },
  });
  if (!existing) throw notFound("Task");
  await assertLinks(user, body);
  const assigneeId = body.assigneeId === undefined ? undefined : ((await resolveOwner(user, body.assigneeId)) ?? undefined);

  const completedAt = body.status === undefined ? undefined : body.status === "DONE" ? (existing.completedAt ?? new Date()) : null;

  const dueChanged = body.dueDate !== undefined && (body.dueDate?.getTime() ?? null) !== (existing.dueDate?.getTime() ?? null);
  const reminderSentAt = dueChanged || (assigneeId !== undefined && assigneeId !== existing.assigneeId) ? null : undefined;

  return db.task.update({
    where: { id, ...tenantScope(user) },
    data: { ...body, assigneeId, completedAt, reminderSentAt },
    include: taskInclude,
  });
}

/** Logs a call, email, meeting or note. The author is always the caller, and links must be records they can see. */
export async function logActivity(user: SessionUser, body: z.infer<typeof createActivitySchema>) {
  await assertLinks(user, body);
  return db.activity.create({
    data: { ...body, ...tenantScope(user), authorId: user.id },
    include: activityInclude,
  });
}

/** Moves a deal through the pipeline. Closing sets closedAt (and probability 100/0); reopening clears closedAt and lostReason. */
export async function changeDealStage(user: SessionUser, id: string, body: z.infer<typeof dealStageSchema>) {
  const existing = await db.deal.findFirst({
    where: { id, deletedAt: null, ...ownerScope(user) },
    select: { stage: true },
  });
  if (!existing) throw notFound("Deal");
  const deal = await db.deal.update({
    where: { id, ...tenantScope(user) },
    data: stageTransition(body.stage, { probability: body.probability, lostReason: body.lostReason }),
    include: dealInclude,
  });
  await notifyDealStageChange({
    deal,
    from: existing.stage,
    to: deal.stage,
    actor: { id: user.id, name: displayName(user), tenantId: user.tenantId },
  });
  await runStageAutomations({ deal, from: existing.stage, to: deal.stage, actor: { id: user.id, tenantId: user.tenantId } });
  return dealDto(deal);
}
