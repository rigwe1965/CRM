import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  resolveInstalmentEmails,
  resolveQuietLeads,
  resolveStageTasks,
  type InstalmentEmailsConfig,
  type QuietLeadsConfig,
  type StageTasksConfig,
} from "@/lib/automations/config";

const STAGE_TASKS = "stage-tasks";
const QUIET_LEADS = "quiet-leads";
const INSTALMENT_EMAILS = "instalment-emails";

export async function loadInstalmentEmails(): Promise<InstalmentEmailsConfig> {
  const row = await db.automationSetting.findUnique({ where: { key: INSTALMENT_EMAILS } });
  return resolveInstalmentEmails(row?.config);
}

export async function loadStageTasks(): Promise<StageTasksConfig> {
  const row = await db.automationSetting.findUnique({ where: { key: STAGE_TASKS } });
  return resolveStageTasks(row?.config);
}

export async function loadQuietLeads(): Promise<QuietLeadsConfig> {
  const row = await db.automationSetting.findUnique({ where: { key: QUIET_LEADS } });
  return resolveQuietLeads(row?.config);
}

/** Saves whichever automations were sent (already validated) and returns the full current settings. */
export async function saveAutomations(
  update: { stageTasks?: StageTasksConfig; quietLeads?: QuietLeadsConfig; instalmentEmails?: InstalmentEmailsConfig },
  updatedById: string,
) {
  const upsert = (key: string, config: unknown) =>
    db.automationSetting.upsert({
      where: { key },
      create: { key, config: config as Prisma.InputJsonValue, updatedById },
      update: { config: config as Prisma.InputJsonValue, updatedById },
    });
  if (update.stageTasks) await upsert(STAGE_TASKS, update.stageTasks);
  if (update.quietLeads) await upsert(QUIET_LEADS, update.quietLeads);
  if (update.instalmentEmails) await upsert(INSTALMENT_EMAILS, update.instalmentEmails);
  return { stageTasks: await loadStageTasks(), quietLeads: await loadQuietLeads(), instalmentEmails: await loadInstalmentEmails() };
}
