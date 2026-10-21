import { ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { automationsUpdateSchema } from "@/lib/automations/config";
import { planInstalmentEmails } from "@/lib/automations/instalment-emails";
import { countQuietLeads } from "@/lib/automations/quiet-leads";
import { loadInstalmentEmails, loadQuietLeads, loadStageTasks, saveAutomations } from "@/lib/automations/settings";

export const dynamic = "force-dynamic";

async function view() {
  const [stageTasks, quietLeads, instalmentEmails] = await Promise.all([loadStageTasks(), loadQuietLeads(), loadInstalmentEmails()]);
  // What each daily automation would do on its next run, so switching one on holds no surprise.
  const [quietLeadsWouldCreate, planned] = await Promise.all([countQuietLeads(quietLeads.days), planInstalmentEmails(instalmentEmails)]);
  return { stageTasks, quietLeads, instalmentEmails, quietLeadsWouldCreate, instalmentEmailsWouldSend: planned.length };
}

/** GET /api/admin/automations: current settings (defaults are all switched off) and a preview count. */
export const GET = authed(async () => ok(await view()), "ADMIN");

/**
 * PUT /api/admin/automations: save any of `stageTasks`, `quietLeads`, `instalmentEmails`. Each is replaced as a whole.
 * Stage rules create a task for the deal owner when a deal moves into that stage; the other two run in the daily cron.
 * Instalment emails go to customers only in LIVE mode; in TEST mode every email goes to `testEmail`.
 */
export const PUT = authed(async ({ req, user }) => {
  const body = await readBody(req, automationsUpdateSchema);
  await saveAutomations(body, user.id);
  return ok(await view());
}, "ADMIN");
