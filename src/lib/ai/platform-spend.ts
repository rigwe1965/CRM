import { platformDb } from "@/lib/platform-db";
import { trySendMail } from "@/lib/mail";
import { platformKey } from "@/lib/ai/included";

/**
 * Guard rails on what the INCLUDED AI costs the owner (INCLUDED_AI_PLAN.md, section 4.5).
 *
 * Every business is capped on its own (plan allowance plus bought credit), so one business cannot overspend. This is the
 * view across all of them: the month's total spend on the owner's Anthropic key, an alert when it nears a limit the owner
 * chose, and a per-business report to check against Anthropic's own bill. It does not replace the hard spending limit that
 * must also be set in the Anthropic console.
 *
 * Off unless INCLUDED_AI_ANTHROPIC_KEY, INCLUDED_AI_ALERT_USD and INCLUDED_AI_ALERT_EMAIL are all set. All money here is
 * in millionths of a US dollar (1_000_000 = $1), estimated from token counts, so it will differ a little from the invoice.
 */
const MICROS = 1_000_000;

/** An alert at 80% and another at 100% of the monthly limit, each once per month. */
export const ALERT_TIERS = [0.8, 1] as const;

export type AlertConfig = { limitMicros: number; to: string };

export function alertConfig(env: Record<string, string | undefined> = process.env): AlertConfig | null {
  const usd = Number(env.INCLUDED_AI_ALERT_USD);
  const to = env.INCLUDED_AI_ALERT_EMAIL?.trim();
  if (!to || !Number.isFinite(usd) || usd <= 0) return null;
  return { limitMicros: Math.round(usd * MICROS), to };
}

export const monthStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
export const dayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** The tiers the spend crossed between `before` (the start of today) and `now`: each fires on the day it is crossed, once. */
export function tiersCrossed(before: number, now: number, limitMicros: number): number[] {
  return ALERT_TIERS.filter((t) => before < t * limitMicros && now >= t * limitMicros);
}

export type Spend = { costMicros: number; creditMicros: number; calls: number };

async function spendBetween(from: Date, to: Date): Promise<Spend> {
  const r = await platformDb.aiUsage.aggregate({
    where: { platformKey: true, createdAt: { gte: from, lt: to } },
    _sum: { costMicros: true, creditMicros: true },
    _count: true,
  });
  return { costMicros: r._sum.costMicros ?? 0, creditMicros: r._sum.creditMicros ?? 0, calls: r._count };
}

const usd = (micros: number) => `$${(micros / MICROS).toFixed(2)}`;

export function spendAlertEmail(o: { tier: number; spend: Spend; limitMicros: number; month: string }) {
  const pct = Math.round(o.tier * 100);
  const subject = o.tier >= 1 ? `Included AI spend has reached your monthly limit (${usd(o.spend.costMicros)})` : `Included AI spend is at ${pct}% of your monthly limit (${usd(o.spend.costMicros)} of ${usd(o.limitMicros)})`;
  const fromAllowance = o.spend.costMicros - o.spend.creditMicros;
  const text = [
    `${o.month}: businesses have used ${usd(o.spend.costMicros)} of AI on your Anthropic key so far this month (limit you set: ${usd(o.limitMicros)}).`,
    "",
    `  Covered by plan allowances: ${usd(fromAllowance)}`,
    `  Covered by bought credit:   ${usd(o.spend.creditMicros)}`,
    `  AI calls:                   ${o.spend.calls}`,
    "",
    o.tier >= 1
      ? "Businesses are still capped by their own allowance and credit, so spending will slow down on its own, but your total may keep growing. Check the hard spending limit on the key in the Anthropic console, and decide whether to raise INCLUDED_AI_ALERT_USD or lower the plan allowances."
      : "Nothing is wrong yet. This is the early warning. Check the hard spending limit on the key in the Anthropic console.",
    "",
    "These figures are estimates from token counts; Anthropic's invoice is the exact amount.",
  ].join("\n");
  return { subject, text };
}

export type PlatformCheck = { skipped: "off" | "no_alert_config" } | { spendMicros: number; limitMicros: number; alerted: number | null };

/** Run once a day from the daily cron. Emails the owner when the month's spend first crosses 80% or 100% of the limit. */
export async function runDailyPlatformAiCheck(now = new Date()): Promise<PlatformCheck> {
  if (!platformKey()) return { skipped: "off" };
  const cfg = alertConfig();
  if (!cfg) return { skipped: "no_alert_config" };
  const start = monthStart(now);
  const [sofar, before] = await Promise.all([spendBetween(start, new Date(now.getTime() + 1)), spendBetween(start, dayStart(now))]);
  const crossed = tiersCrossed(before.costMicros, sofar.costMicros, cfg.limitMicros);
  // Both tiers in one day (a big jump): one email, for the higher one.
  const tier = crossed.length ? Math.max(...crossed) : null;
  if (tier !== null) {
    const month = start.toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" });
    const mail = spendAlertEmail({ tier, spend: sofar, limitMicros: cfg.limitMicros, month });
    await trySendMail({ to: cfg.to, ...mail });
  }
  return { spendMicros: sofar.costMicros, limitMicros: cfg.limitMicros, alerted: tier };
}

export type ReportRow = { tenantId: string; name: string; plan: string; calls: number; costMicros: number; fromCreditMicros: number; creditLeftMicros: number };
export type SpendReport = { month: string; total: Spend; rows: ReportRow[] };

/** This month's included-AI spend per business, biggest first, for checking against Anthropic's bill. Read-only. */
export async function buildSpendReport(now = new Date()): Promise<SpendReport> {
  const start = monthStart(now);
  const where = { platformKey: true, createdAt: { gte: start, lt: new Date(now.getTime() + 1) } };
  const [byTenant, total] = await Promise.all([
    platformDb.aiUsage.groupBy({ by: ["tenantId"], where, _sum: { costMicros: true, creditMicros: true }, _count: true }),
    spendBetween(start, new Date(now.getTime() + 1)),
  ]);
  const ids = byTenant.map((r) => r.tenantId);
  const [tenants, bought, usedAllTime] = await Promise.all([
    platformDb.tenant.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, plan: true } }),
    platformDb.aiCredit.groupBy({ by: ["tenantId"], where: { tenantId: { in: ids } }, _sum: { amountMicros: true } }),
    platformDb.aiUsage.groupBy({ by: ["tenantId"], where: { tenantId: { in: ids }, platformKey: true }, _sum: { creditMicros: true } }),
  ]);
  const name = new Map(tenants.map((t) => [t.id, t]));
  const boughtBy = new Map(bought.map((r) => [r.tenantId, r._sum.amountMicros ?? 0]));
  const usedBy = new Map(usedAllTime.map((r) => [r.tenantId, r._sum.creditMicros ?? 0]));
  const rows = byTenant
    .map((r) => ({
      tenantId: r.tenantId,
      name: name.get(r.tenantId)?.name ?? "(unknown)",
      plan: name.get(r.tenantId)?.plan ?? "?",
      calls: r._count,
      costMicros: r._sum.costMicros ?? 0,
      fromCreditMicros: r._sum.creditMicros ?? 0,
      creditLeftMicros: Math.max(0, (boughtBy.get(r.tenantId) ?? 0) - (usedBy.get(r.tenantId) ?? 0)),
    }))
    .sort((a, b) => b.costMicros - a.costMicros);
  return { month: start.toISOString().slice(0, 7), total, rows };
}

export function formatSpendReport(r: SpendReport): string {
  const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
  const lines = [
    `Included AI spend, ${r.month} (UTC), estimated from token counts`,
    `Total ${usd(r.total.costMicros)} over ${r.total.calls} calls: ${usd(r.total.costMicros - r.total.creditMicros)} from plan allowances, ${usd(r.total.creditMicros)} from bought credit`,
    "",
    `${pad("Business", 28)}${pad("Plan", 10)}${pad("Calls", 8)}${pad("Spend", 10)}${pad("From credit", 13)}Credit left`,
    ...r.rows.map((x) => `${pad(x.name, 28)}${pad(x.plan, 10)}${pad(String(x.calls), 8)}${pad(usd(x.costMicros), 10)}${pad(usd(x.fromCreditMicros), 13)}${usd(x.creditLeftMicros)}`),
    "",
    "Compare the total with the Usage page of the Anthropic console for the same key. Small differences are normal.",
  ];
  return lines.join("\n");
}
