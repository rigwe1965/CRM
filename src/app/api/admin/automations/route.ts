import { ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { automationsUpdateSchema } from "@/lib/automations/config";
import { planInstalmentEmails } from "@/lib/automations/instalment-emails";
import { countLowStock } from "@/lib/automations/low-stock";
import { countQuietLeads } from "@/lib/automations/quiet-leads";
import { loadInstalmentEmails, loadLowStock, loadQuietLeads, loadStageTasks, saveAutomations } from "@/lib/automations/settings";

export const dynamic = "force-dynamic";

async function view(tenantId: string) {
  const [stageTasks, quietLeads, instalmentEmails, lowStock] = await Promise.all([
    loadStageTasks(tenantId),
    loadQuietLeads(tenantId),
    loadInstalmentEmails(tenantId),
    loadLowStock(tenantId),
  ]);
  // What each daily automation would do on its next run, so switching one on holds no surprise.
  const [quietLeadsWouldCreate, planned, lowStockNow] = await Promise.all([
    countQuietLeads(tenantId, quietLeads.days),
    planInstalmentEmails(tenantId, instalmentEmails),
    countLowStock(tenantId, lowStock.defaultThreshold),
  ]);
  return { stageTasks, quietLeads, instalmentEmails, lowStock, quietLeadsWouldCreate, instalmentEmailsWouldSend: planned.length, lowStockNow };
}

/** GET /api/admin/automations: current settings (defaults are all switched off) and a preview count. */
export const GET = authed(async ({ user }) => ok(await view(user.tenantId)), "ADMIN");

/**
 * PUT /api/admin/automations: save any of `stageTasks`, `quietLeads`, `instalmentEmails`, `lowStock`. Each is replaced as a whole.
 * Stage rules create a task for the deal owner when a deal moves into that stage; the others run in the daily cron.
 * Low stock emails the admins when a stock row drops to its level (`defaultThreshold` pieces unless the row has its own).
 * Instalment emails go to customers only in LIVE mode; in TEST mode every email goes to `testEmail`.
 */
export const PUT = authed(async ({ req, user }) => {
  const body = await readBody(req, automationsUpdateSchema);
  await saveAutomations(body, user.id, user.tenantId);
  return ok(await view(user.tenantId));
}, "ADMIN");
