import { afterEach, describe, expect, it, vi } from "vitest";
import { systemChecks, type CheckInputs } from "@/lib/system-check";

afterEach(() => vi.unstubAllEnvs());

const good: CheckInputs = {
  env: {
    NODE_ENV: "production", CRON_SECRET: "c".repeat(20), UPSTASH_REDIS_REST_URL: "https://u.test", UPSTASH_REDIS_REST_TOKEN: "tok-secret-value",
    TRUSTED_PROXY_COUNT: "1", RESEND_API_KEY: "re_secret_value", SENTRY_DSN: "https://k@sentry.test/1", REQUIRE_ADMIN_MFA: "1",
  },
  rlsWarning: null,
  daily: { stale: false, ageHours: 3, lastRunOk: true },
};
const status = (i: CheckInputs, id: string) => systemChecks(i).find((c) => c.id === id)?.status;

describe("system check", () => {
  it("is all ok for a well set-up installation", () => {
    expect(systemChecks(good).filter((c) => c.status !== "ok")).toEqual([]);
  });

  it("fails loudly when the database role would ignore row-level security", () => {
    expect(status({ ...good, rlsWarning: "DATABASE_URL connects as a role that bypasses row-level security" }, "rls")).toBe("fail");
  });

  it("flags a stale, never-run or partly failing daily job", () => {
    expect(status({ ...good, daily: { stale: true, ageHours: 40, lastRunOk: true } }, "cron")).toBe("fail");
    expect(status({ ...good, daily: { stale: true, ageHours: null, lastRunOk: null } }, "cron")).toBe("fail");
    expect(status({ ...good, daily: { stale: false, ageHours: 2, lastRunOk: false } }, "cron")).toBe("warn");
    expect(status({ ...good, daily: null }, "cron")).toBe("warn");
  });

  it("flags missing production basics", () => {
    const env = { ...good.env, CRON_SECRET: "short", UPSTASH_REDIS_REST_URL: undefined, RESEND_API_KEY: undefined, TRUSTED_PROXY_COUNT: undefined };
    const i = { ...good, env };
    expect(status(i, "cron-secret")).toBe("fail");
    expect(status(i, "rate-limit")).toBe("fail");
    expect(status(i, "mail")).toBe("fail");
    expect(status(i, "proxy")).toBe("warn");
  });

  it("only judges sign-up protection when sign-up is on, and flags a leftover dev shortcut", () => {
    expect(systemChecks(good).some((c) => c.id === "signup")).toBe(false);
    expect(status({ ...good, env: { ...good.env, SIGNUP_ENABLED: "1" } }, "signup")).toBe("fail");
    expect(status({ ...good, env: { ...good.env, SIGNUP_DEV_LINKS: "1" } }, "dev-flags")).toBe("fail");
  });

  it("never puts a secret, key or address in its text", () => {
    const text = JSON.stringify(systemChecks({ ...good, env: { ...good.env, SIGNUP_ENABLED: "1" } }));
    for (const secret of ["tok-secret-value", "re_secret_value", "https://u.test", "sentry.test", "c".repeat(20)]) expect(text).not.toContain(secret);
  });
});
