import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  resolveInstalmentEmails,
  resolveLowStock,
  resolveQuietLeads,
  resolveShippingUpdates,
  resolveStageTasks,
  type InstalmentEmailsConfig,
  type LowStockConfig,
  type QuietLeadsConfig,
  type ShippingUpdatesConfig,
  type StageTasksConfig,
} from "@/lib/automations/config";

const STAGE_TASKS = "stage-tasks";
const QUIET_LEADS = "quiet-leads";
const INSTALMENT_EMAILS = "instalment-emails";
const LOW_STOCK = "low-stock";
const SHIPPING_UPDATES = "shipping-updates";

export async function loadShippingUpdates(tenantId: string): Promise<ShippingUpdatesConfig> {
  const row = await db.automationSetting.findUnique({ where: { tenantId_key: { tenantId, key: SHIPPING_UPDATES } } });
  return resolveShippingUpdates(row?.config);
}

export async function loadLowStock(tenantId: string): Promise<LowStockConfig> {
  const row = await db.automationSetting.findUnique({ where: { tenantId_key: { tenantId, key: LOW_STOCK } } });
  return resolveLowStock(row?.config);
}

export async function loadInstalmentEmails(tenantId: string): Promise<InstalmentEmailsConfig> {
  const row = await db.automationSetting.findUnique({ where: { tenantId_key: { tenantId, key: INSTALMENT_EMAILS } } });
  const tenant = await db.tenant.findFirst({ where: { id: tenantId }, select: { name: true, brandName: true } });
  return resolveInstalmentEmails(row?.config, tenant?.brandName || tenant?.name);
}

export async function loadStageTasks(tenantId: string): Promise<StageTasksConfig> {
  const row = await db.automationSetting.findUnique({ where: { tenantId_key: { tenantId, key: STAGE_TASKS } } });
  return resolveStageTasks(row?.config);
}

export async function loadQuietLeads(tenantId: string): Promise<QuietLeadsConfig> {
  const row = await db.automationSetting.findUnique({ where: { tenantId_key: { tenantId, key: QUIET_LEADS } } });
  return resolveQuietLeads(row?.config);
}

/** Saves whichever automations were sent (already validated) for one business and returns its full current settings. */
export async function saveAutomations(
  update: { stageTasks?: StageTasksConfig; quietLeads?: QuietLeadsConfig; instalmentEmails?: InstalmentEmailsConfig; lowStock?: LowStockConfig; shippingUpdates?: ShippingUpdatesConfig },
  updatedById: string,
  tenantId: string,
) {
  const upsert = (key: string, config: unknown) =>
    db.automationSetting.upsert({
      where: { tenantId_key: { tenantId, key } },
      create: { tenantId, key, config: config as Prisma.InputJsonValue, updatedById },
      update: { config: config as Prisma.InputJsonValue, updatedById },
    });
  if (update.stageTasks) await upsert(STAGE_TASKS, update.stageTasks);
  if (update.quietLeads) await upsert(QUIET_LEADS, update.quietLeads);
  if (update.instalmentEmails) await upsert(INSTALMENT_EMAILS, update.instalmentEmails);
  if (update.lowStock) await upsert(LOW_STOCK, update.lowStock);
  if (update.shippingUpdates) await upsert(SHIPPING_UPDATES, update.shippingUpdates);
  return {
    stageTasks: await loadStageTasks(tenantId),
    quietLeads: await loadQuietLeads(tenantId),
    instalmentEmails: await loadInstalmentEmails(tenantId),
    lowStock: await loadLowStock(tenantId),
    shippingUpdates: await loadShippingUpdates(tenantId),
  };
}
