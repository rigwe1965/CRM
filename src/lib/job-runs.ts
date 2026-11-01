import { platformDb } from "@/lib/platform-db";

/**
 * Heartbeat for platform jobs (the daily cron). Each run leaves a `JobRun` row, so "did it run, and did it work" has an
 * answer, and the deep health check can say so. An optional ping URL (HEALTHCHECK_PING_URL, e.g. Healthchecks.io) is
 * called on success and at `/fail` on failure, which is what raises an alert when the job silently stops: nothing
 * inside the app can notice that it was never called.
 */
export const STALE_AFTER_HOURS = 26; // a daily job plus slack for a late scheduler
const KEEP_DAYS = 90;
const HOUR_MS = 3_600_000;

export type JobOutcome = { ok: boolean; summary?: Record<string, unknown> };

async function ping(suffix: "" | "/fail") {
  const base = process.env.HEALTHCHECK_PING_URL?.trim().replace(/\/$/, "");
  if (!base) return;
  try {
    await fetch(`${base}${suffix}`, { signal: AbortSignal.timeout(5000), cache: "no-store" });
  } catch (e) {
    console.error("[job-runs] ping failed", e instanceof Error ? e.message : e);
  }
}

/**
 * Runs `fn`, recording its start and result. A throw counts as a failure and is rethrown. Recording problems never
 * stop the job itself: the work matters more than the note about it.
 */
export async function recordJob<T extends JobOutcome>(job: string, fn: () => Promise<T>): Promise<T> {
  const id = await platformDb.jobRun.create({ data: { job }, select: { id: true } }).then((r) => r.id, (e) => (console.error("[job-runs] could not record start", e instanceof Error ? e.message : e), null));
  const finish = async (ok: boolean, summary?: Record<string, unknown>) => {
    if (!id) return;
    await platformDb.jobRun
      .update({ where: { id }, data: { finishedAt: new Date(), ok, summary: (summary ?? {}) as object } })
      .catch((e) => console.error("[job-runs] could not record finish", e instanceof Error ? e.message : e));
    await platformDb.jobRun.deleteMany({ where: { job, startedAt: { lt: new Date(Date.now() - KEEP_DAYS * 24 * HOUR_MS) } } }).catch(() => undefined);
  };
  try {
    const out = await fn();
    await finish(out.ok, out.summary);
    await ping(out.ok ? "" : "/fail");
    return out;
  } catch (e) {
    await finish(false, { error: e instanceof Error ? e.message.slice(0, 300) : "failed" });
    await ping("/fail");
    throw e;
  }
}

export type JobStatus = { job: string; lastSuccessAt: string | null; lastRunAt: string | null; lastRunOk: boolean | null; ageHours: number | null; stale: boolean };

/** When the job last worked, and whether that is too long ago. A job that never ran is stale. */
export async function jobStatus(job: string, now = new Date()): Promise<JobStatus> {
  const [success, last] = await Promise.all([
    platformDb.jobRun.findFirst({ where: { job, ok: true }, orderBy: { startedAt: "desc" }, select: { startedAt: true } }),
    platformDb.jobRun.findFirst({ where: { job }, orderBy: { startedAt: "desc" }, select: { startedAt: true, ok: true } }),
  ]);
  const ageHours = success ? Math.round(((now.getTime() - success.startedAt.getTime()) / HOUR_MS) * 10) / 10 : null;
  return {
    job,
    lastSuccessAt: success?.startedAt.toISOString() ?? null,
    lastRunAt: last?.startedAt.toISOString() ?? null,
    lastRunOk: last?.ok ?? null,
    ageHours,
    stale: ageHours === null || ageHours > STALE_AFTER_HOURS,
  };
}
