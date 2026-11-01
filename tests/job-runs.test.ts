import { beforeEach, describe, expect, it, vi } from "vitest";

const { rows, jobRun } = vi.hoisted(() => {
  const rows: { id: string; job: string; startedAt: Date; finishedAt: Date | null; ok: boolean | null; summary: unknown }[] = [];
  const jobRun = {
    create: vi.fn(async ({ data }: { data: { job: string } }) => {
      const r = { id: `r${rows.length + 1}`, job: data.job, startedAt: new Date(), finishedAt: null, ok: null, summary: null };
      rows.push(r);
      return r;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(rows.find((r) => r.id === where.id)!, data)),
    deleteMany: vi.fn(async () => ({ count: 0 })),
    findFirst: vi.fn(async ({ where }: { where: { job: string; ok?: boolean } }) =>
      [...rows].reverse().find((r) => r.job === where.job && (where.ok === undefined || r.ok === where.ok)) ?? null),
  };
  return { rows, jobRun };
});
vi.mock("@/lib/platform-db", () => ({ platformDb: { jobRun, $queryRaw: vi.fn(async () => [{ "?column?": 1 }]) } }));

import { jobStatus, recordJob, STALE_AFTER_HOURS } from "@/lib/job-runs";
import { GET as health } from "@/app/api/health/route";

beforeEach(() => {
  rows.length = 0;
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("ok")));
});

describe("job heartbeat", () => {
  it("records a successful run and pings the monitor", async () => {
    vi.stubEnv("HEALTHCHECK_PING_URL", "https://hc.example/abc/");
    await recordJob("daily", async () => ({ ok: true, summary: { sent: 3 } }));
    expect(rows[0]).toMatchObject({ ok: true, summary: { sent: 3 } });
    expect(rows[0].finishedAt).toBeInstanceOf(Date);
    expect(fetch).toHaveBeenCalledWith("https://hc.example/abc", expect.anything());
  });

  it("records a failed step as not ok and pings /fail", async () => {
    vi.stubEnv("HEALTHCHECK_PING_URL", "https://hc.example/abc");
    await recordJob("daily", async () => ({ ok: false, summary: { failedSteps: ["campaigns"] } }));
    expect(rows[0].ok).toBe(false);
    expect(fetch).toHaveBeenCalledWith("https://hc.example/abc/fail", expect.anything());
  });

  it("records a throw as a failure and rethrows it", async () => {
    await expect(
      recordJob("daily", async () => {
        throw new Error("db down");
      }),
    ).rejects.toThrow("db down");
    expect(rows[0]).toMatchObject({ ok: false, summary: { error: "db down" } });
  });

  it("does not stop the job when the heartbeat cannot be written or the monitor is unreachable", async () => {
    vi.stubEnv("HEALTHCHECK_PING_URL", "https://hc.example/abc");
    jobRun.create.mockRejectedValueOnce(new Error("no table"));
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    await expect(recordJob("daily", async () => ({ ok: true }))).resolves.toEqual({ ok: true });
  });

  it("calls a job that never ran, or last worked too long ago, stale", async () => {
    expect((await jobStatus("daily")).stale).toBe(true);
    rows.push({ id: "x", job: "daily", startedAt: new Date(Date.now() - 2 * 3_600_000), finishedAt: new Date(), ok: true, summary: null });
    expect((await jobStatus("daily")).stale).toBe(false);
    rows[0].startedAt = new Date(Date.now() - (STALE_AFTER_HOURS + 1) * 3_600_000);
    expect((await jobStatus("daily")).stale).toBe(true);
  });
});

describe("GET /api/health", () => {
  const call = (url: string, auth?: string) => health(new Request(url, { headers: auth ? { authorization: auth } : {} }));

  it("stays minimal and public without ?deep", async () => {
    const res = await call("http://x.test/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("keeps the deep check behind the cron secret", async () => {
    vi.stubEnv("CRON_SECRET", "s".repeat(20));
    expect((await call("http://x.test/api/health?deep=1")).status).toBe(401);
    expect((await call("http://x.test/api/health?deep=1", "Bearer wrong")).status).toBe(401);
  });

  it("answers 503 when the daily job is stale and 200 when it is fresh", async () => {
    vi.stubEnv("CRON_SECRET", "s".repeat(20));
    const auth = `Bearer ${"s".repeat(20)}`;
    const stale = await call("http://x.test/api/health?deep=1", auth);
    expect(stale.status).toBe(503);
    expect((await stale.json()).status).toBe("stale");
    await recordJob("daily", async () => ({ ok: true }));
    expect((await call("http://x.test/api/health?deep=1", auth)).status).toBe(200);
  });
});
