import { platformDb } from "@/lib/platform-db";
import { withTenant } from "@/lib/tenant-context";
import { runInstalmentEmails } from "@/lib/automations/instalment-emails";
import { runQuietLeadNudges } from "@/lib/automations/quiet-leads";

export { runStageAutomations } from "@/lib/automations/stage-tasks";

/**
 * The daily automations. Run before the reminder emails so tasks created here are in today's digest.
 * Each one is isolated: a failure is logged and reported but never stops the others or the reminders after.
 */
export async function runDailyAutomations(now = new Date()) {
  // Each active business runs on its own settings and only ever touches its own rows.
  const tenants = await platformDb.tenant.findMany({ where: { status: "ACTIVE" }, select: { id: true }, orderBy: { createdAt: "asc" } });
  const perTenant: Awaited<ReturnType<typeof runTenantAutomations>>[] = [];
  for (const { id } of tenants) perTenant.push(await withTenant(id, () => runTenantAutomations(id, now)));
  const sum = (pick: (r: (typeof perTenant)[number]) => number) => perTenant.reduce((s, r) => s + pick(r), 0);
  return {
    ok: perTenant.every((r) => r.ok),
    quietLeads: { ok: perTenant.every((r) => r.quietLeads.ok), created: sum((r) => r.quietLeads.created) },
    instalmentEmails: {
      ok: perTenant.every((r) => r.instalmentEmails.ok),
      sent: sum((r) => r.instalmentEmails.sent),
      failed: sum((r) => r.instalmentEmails.failed),
      tasks: sum((r) => r.instalmentEmails.tasks),
      test: perTenant.every((r) => r.instalmentEmails.test),
    },
  };
}

async function runTenantAutomations(tenantId: string, now: Date) {
  const attempt = async <T>(name: string, fallback: T, fn: () => Promise<T>) => {
    try {
      return { ok: true, ...(await fn()) as object } as { ok: boolean } & T;
    } catch (e) {
      console.error(`[automation] ${name} failed`, e);
      return { ok: false, ...fallback };
    }
  };
  const quietLeads = await attempt("quiet leads", { created: 0 }, () => runQuietLeadNudges(tenantId, now));
  const instalmentEmails = await attempt("instalment emails", { sent: 0, failed: 0, tasks: 0, test: true }, () => runInstalmentEmails(tenantId, now));
  return { ok: quietLeads.ok && instalmentEmails.ok, quietLeads, instalmentEmails };
}
