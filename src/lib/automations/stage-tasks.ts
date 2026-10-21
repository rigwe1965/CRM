import type { DealStage } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { renderTitle, STAGE_LABEL } from "@/lib/automations/config";
import { loadStageTasks } from "@/lib/automations/settings";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When a deal moves into a stage that has a rule, creates a task for the deal's owner (created by whoever
 * moved the deal). One open task per deal and stage: dragging a card back and forth doesn't pile them up.
 * Never throws: a failure here must not undo the stage change that triggered it.
 */
export async function runStageAutomations(opts: {
  deal: {
    id: string;
    title: string;
    ownerId: string;
    contactId: string | null;
    contact?: { firstName: string; lastName: string } | null;
  };
  from: DealStage;
  to: DealStage;
  actor: { id: string };
}) {
  const { deal, from, to, actor } = opts;
  if (from === to) return;
  try {
    const config = await loadStageTasks();
    const rule = config.stages[to];
    if (!config.enabled || !rule.enabled || !rule.title) return;

    const automationKey = `stage:${deal.id}:${to}`;
    const open = await db.task.findFirst({
      where: { automationKey, status: { in: ["TODO", "IN_PROGRESS"] } },
      select: { id: true },
    });
    if (open) return;

    const customer = deal.contact ? `${deal.contact.firstName} ${deal.contact.lastName}` : deal.title;
    const task = await db.task.create({
      data: {
        title: renderTitle(rule.title, { deal: deal.title, customer, stage: STAGE_LABEL[to] }),
        description: `Created automatically when "${deal.title}" moved to ${STAGE_LABEL[to]}.`,
        priority: rule.priority,
        dueDate: new Date(Date.now() + rule.dueInDays * DAY_MS),
        assigneeId: deal.ownerId,
        createdById: actor.id,
        dealId: deal.id,
        contactId: deal.contactId,
        automationKey,
      },
      select: { id: true, title: true },
    });
    await audit({ email: "automation" }, { action: "automation.stage_task", entity: "deal", entityId: deal.id, summary: task.title });
  } catch (e) {
    console.error("[automation] stage task failed", e);
  }
}
