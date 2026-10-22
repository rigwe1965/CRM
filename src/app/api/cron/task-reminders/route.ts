import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { runDailyAutomations } from "@/lib/automations";
import { purgeUnconfirmedSignups } from "@/lib/signup";
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
 * sends automatically (see vercel.json). Safe to call repeatedly: each task is reminded once.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  // Automations first, so the tasks they create are in today's reminder digest.
  const automations = await runDailyAutomations();
  const tasks = await sendTaskReminders();
  const instalments = await sendInstalmentReminders();
  // Signups nobody confirmed within a week are removed.
  const unconfirmedSignups = await purgeUnconfirmedSignups().catch((e) => (console.error("[signup] purge failed", e), -1));
  // `tasks` fields stay at the top level for existing callers.
  return NextResponse.json({ ok: true, ...tasks, instalmentReminders: instalments, automations, unconfirmedSignups });
}
