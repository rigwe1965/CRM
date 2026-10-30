import { platformDb } from "@/lib/platform-db";
import { withTenant } from "@/lib/tenant-context";
import { runInstalmentEmails, runInstalmentWhatsapps } from "@/lib/automations/instalment-emails";
import { runLowStockAlerts } from "@/lib/automations/low-stock";
import { runQuietLeadNudges } from "@/lib/automations/quiet-leads";

import { reconcileTenant } from "@/lib/reconcile";

export { runStageAutomations } from "@/lib/automations/stage-tasks";

/**
 * Daily money-consistency check (src/lib/reconcile.ts). Read-only and report-only for now: it logs what it finds,
 * and admins see the same list under Reports. One business failing never stops the others.
 */
export async function runDailyReconciliation() {
  const tenants = await platformDb.tenant.findMany({ where: { status: "ACTIVE" }, select: { id: true }, orderBy: { createdAt: "asc" } });
  let checked = 0;
  let high = 0;
  let low = 0;
  let failed = 0;
  for (const { id } of tenants) {
    try {
      const r = await withTenant(id, () => reconcileTenant({ tenantId: id }, Number.POSITIVE_INFINITY));
      checked += r.checked;
      const h = r.findings.filter((f) => f.severity === "high").length;
      high += h;
      low += r.findings.length - h;
      if (h > 0) console.warn(`[reconcile] ${id}: ${h} money issue(s) need a look`, r.counts);
    } catch (e) {
      failed++;
      console.error(`[reconcile] ${id} failed`, e);
    }
  }
  return { tenants: tenants.length, deals: checked, high, low, failed };
}

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
    instalmentWhatsapps: {
      ok: perTenant.every((r) => r.instalmentWhatsapps.ok),
      sent: sum((r) => r.instalmentWhatsapps.sent),
      failed: sum((r) => r.instalmentWhatsapps.failed),
      tasks: sum((r) => r.instalmentWhatsapps.tasks),
    },
    lowStock: { ok: perTenant.every((r) => r.lowStock.ok), alerted: sum((r) => r.lowStock.alerted), failed: sum((r) => r.lowStock.failed) },
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
  const instalmentWhatsapps = await attempt("instalment whatsapps", { sent: 0, failed: 0, tasks: 0, test: true }, () => runInstalmentWhatsapps(tenantId, now));
  const lowStock = await attempt("low stock", { alerted: 0, failed: 0 }, () => runLowStockAlerts(tenantId));
  return { ok: quietLeads.ok && instalmentEmails.ok && instalmentWhatsapps.ok && lowStock.ok, quietLeads, instalmentEmails, instalmentWhatsapps, lowStock };
}
