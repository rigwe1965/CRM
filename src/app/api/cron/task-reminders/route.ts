import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { sendTaskReminders } from "@/lib/notifications";

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
 * GET /api/cron/task-reminders: emails assignees about overdue / due-within-24h tasks.
 * Public path (no session) but requires `Authorization: Bearer $CRON_SECRET`, which Vercel Cron
 * sends automatically (see vercel.json). Safe to call repeatedly: each task is reminded once.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  const result = await sendTaskReminders();
  return NextResponse.json({ ok: true, ...result });
}
