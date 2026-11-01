import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { jobStatus } from "@/lib/job-runs";
import { platformDb } from "@/lib/platform-db";

export const dynamic = "force-dynamic";

const cronAuthorized = (req: Request) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
};

/**
 * GET /api/health: liveness + database connectivity, for uptime monitors and post-deploy checks. Public and minimal.
 * GET /api/health?deep=1 with `Authorization: Bearer $CRON_SECRET` also says whether the daily job has run lately, and
 * answers 503 when it has not (so an uptime monitor pointed at it alerts). The details never go to anonymous callers.
 */
export async function GET(req: Request) {
  try {
    await platformDb.$queryRaw`SELECT 1`;
  } catch (e) {
    console.error("health check failed", e);
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
  if (new URL(req.url).searchParams.get("deep") !== "1") return NextResponse.json({ status: "ok" });
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  try {
    const daily = await jobStatus("daily");
    return NextResponse.json({ status: daily.stale ? "stale" : "ok", jobs: [daily] }, { status: daily.stale ? 503 : 200 });
  } catch (e) {
    console.error("deep health check failed", e);
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
