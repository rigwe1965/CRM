import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { recordJob } from "@/lib/job-runs";
import { runDailyAiRetention, runDailyAutomations, runDailyCampaigns, runDailyReconciliation } from "@/lib/automations";
import { purgeUnconfirmedSignups } from "@/lib/signup";
import { purgeDeletedTenants } from "@/lib/tenant-deletion";
import { sendInstalmentReminders, sendTaskReminders } from "@/lib/notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
// Next caches identical POST fetches made from GET route handlers, which would silently swallow a
// repeated email (same recipient and text). Outgoing mail must always hit the provider.
export const fetchCache = "force-no-store";

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // never open when unconfigured
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * GET /api/cron/task-reminders: emails assignees about overdue / due-within-24h tasks, and deal owners
 * about customer instalments that are due or late, after running the daily automations (quiet-lead
 * follow-up tasks). One daily cron covers all of it.
 * Public path (no session) but requires `Authorization: Bearer $CRON_SECRET`, which Vercel Cron
 * sends automatically when a Vercel cron is configured. Safe to call repeatedly: each task is reminded once.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  return NextResponse.json(await recordJob("daily", async () => {
    // Automations first, so the tasks they create are in today's reminder digest.
    const automations = await runDailyAutomations();
    const tasks = await sendTaskReminders();
    const instalments = await sendInstalmentReminders();
    // Signups nobody confirmed within a week are removed.
    const unconfirmedSignups = await purgeUnconfirmedSignups().catch((e) => (console.error("[signup] purge failed", e), -1));
    // Businesses whose 30-day deletion grace period is over are erased.
    const erasedBusinesses = await purgeDeletedTenants().catch((e) => (console.error("[tenant] purge failed", e), null));
    // Read-only money check; a failure here must never stop the reminders above from having gone out.
    const reconciliation = await runDailyReconciliation().catch((e) => (console.error("[reconcile] run failed", e), null));
    // Ivy conversations are kept for AI_RETENTION_DAYS; a failure here must not affect the rest.
    const aiRetention = await runDailyAiRetention().catch((e) => (console.error("[ai] retention run failed", e), null));
    // Broadcast campaigns left unfinished (an admin closed the page) carry on here.
    const campaigns = await runDailyCampaigns().catch((e) => (console.error("[campaign] run failed", e), null));
    // `tasks` fields stay at the top level for existing callers.
    // The steps above swallow their own errors so one failure cannot stop the rest; the heartbeat still records it.
    const failedSteps = [unconfirmedSignups === -1 && "signups", erasedBusinesses === null && "deletions", reconciliation === null && "reconciliation", aiRetention === null && "retention", campaigns === null && "campaigns"].filter(Boolean);
    return { ok: failedSteps.length === 0, summary: { failedSteps }, response: { ok: true, ...tasks, instalmentReminders: instalments, automations, unconfirmedSignups, erasedBusinesses, reconciliation, aiRetention, campaigns } };
  }).then((r) => r.response));
}
