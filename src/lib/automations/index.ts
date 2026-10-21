import { runInstalmentEmails } from "@/lib/automations/instalment-emails";
import { runQuietLeadNudges } from "@/lib/automations/quiet-leads";

export { runStageAutomations } from "@/lib/automations/stage-tasks";

/**
 * The daily automations. Run before the reminder emails so tasks created here are in today's digest.
 * Each one is isolated: a failure is logged and reported but never stops the others or the reminders after.
 */
export async function runDailyAutomations(now = new Date()) {
  const attempt = async <T>(name: string, fallback: T, fn: () => Promise<T>) => {
    try {
      return { ok: true, ...(await fn()) as object } as { ok: boolean } & T;
    } catch (e) {
      console.error(`[automation] ${name} failed`, e);
      return { ok: false, ...fallback };
    }
  };
  const quietLeads = await attempt("quiet leads", { created: 0 }, () => runQuietLeadNudges(now));
  const instalmentEmails = await attempt("instalment emails", { sent: 0, failed: 0, tasks: 0, test: true }, () => runInstalmentEmails(now));
  return { ok: quietLeads.ok && instalmentEmails.ok, quietLeads, instalmentEmails };
}
