import { adminMfaRequired } from "@/lib/rbac";

/**
 * A read-only self-check of the deployment, for the platform owner (the original business's admins) only. It answers
 * "is this installation set up the way the runbook says" in one place instead of five. Every line is a plain verdict
 * and sentence: no values, keys or addresses ever appear here.
 */
export type CheckStatus = "ok" | "warn" | "fail";
export type Check = { id: string; label: string; status: CheckStatus; detail: string };

type Env = Record<string, string | undefined>;
export type CheckInputs = {
  env: Env;
  /** Result of `rowLevelSecurityWarning`: a warning sentence, null when the policies hold, undefined if it could not run. */
  rlsWarning: string | null | undefined;
  /** The daily job's state from `jobStatus`, or null if it could not be read. */
  daily: { stale: boolean; ageHours: number | null; lastRunOk: boolean | null } | null;
};

const on = (v: string | undefined) => v === "1" || v === "true";

export function systemChecks({ env, rlsWarning, daily }: CheckInputs): Check[] {
  const production = env.NODE_ENV === "production";
  const out: Check[] = [];
  const add = (id: string, label: string, status: CheckStatus, detail: string) => out.push({ id, label, status, detail });

  if (rlsWarning === undefined) add("rls", "Businesses separated by the database", "warn", "Could not be checked.");
  else if (rlsWarning === null) add("rls", "Businesses separated by the database", "ok", "Row-level security binds the role the app connects as.");
  else add("rls", "Businesses separated by the database", "fail", `${rlsWarning}. Businesses are separated by application filters only.`);

  if (!daily) add("cron", "Daily job", "warn", "Its history could not be read.");
  else if (daily.ageHours === null) add("cron", "Daily job", production ? "fail" : "warn", "It has never run. Check that the scheduler calls /api/cron/task-reminders.");
  else if (daily.stale) add("cron", "Daily job", "fail", `It last worked ${daily.ageHours} hours ago.`);
  else if (daily.lastRunOk === false) add("cron", "Daily job", "warn", "The most recent run had a failing step. See the server log.");
  else add("cron", "Daily job", "ok", `It last worked ${daily.ageHours} hours ago.`);

  add("cron-secret", "Scheduler secret", (env.CRON_SECRET?.length ?? 0) >= 16 ? "ok" : "fail", (env.CRON_SECRET?.length ?? 0) >= 16 ? "Set." : "CRON_SECRET is missing or shorter than 16 characters, so the daily job cannot run.");

  add("admin-mfa", "Two-step verification for admins", adminMfaRequired(env) ? "ok" : "warn", adminMfaRequired(env) ? "Required." : "Not required (REQUIRE_ADMIN_MFA is off).");

  const shared = !!(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
  add("rate-limit", "Rate limits shared across servers", shared ? "ok" : production ? "fail" : "warn", shared ? "Shared store configured." : "No shared store: each server counts on its own, so limits are only best-effort.");

  const proxyKnown = !!env.VERCEL || !!env.TRUSTED_PROXY_COUNT;
  add("proxy", "Client address handling", proxyKnown ? "ok" : "warn", env.VERCEL ? "The platform supplies the client address." : proxyKnown ? "TRUSTED_PROXY_COUNT is set." : "TRUSTED_PROXY_COUNT is not set, so one proxy is assumed.");

  const mail = !!(env.RESEND_API_KEY || env.EMAIL_SERVER);
  add("mail", "Email sending", mail ? "ok" : production ? "fail" : "warn", mail ? "A provider is configured." : "No provider: sign-in links and reminders are only printed to the log.");

  if (on(env.SIGNUP_ENABLED)) {
    const captcha = !!(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY);
    add("signup", "Public sign-up protection", captcha ? "ok" : "fail", captcha ? "CAPTCHA configured." : "Sign-up is open without a CAPTCHA.");
  }

  add("dev-flags", "Development shortcuts", env.SIGNUP_DEV_LINKS === "1" ? (production ? "fail" : "warn") : "ok", env.SIGNUP_DEV_LINKS === "1" ? "SIGNUP_DEV_LINKS is on; the sign-up confirmation link is returned in the response." : "Off.");

  add("errors", "Error tracking", env.SENTRY_DSN ? "ok" : "warn", env.SENTRY_DSN ? "Configured." : "Not configured, so server errors are only in the log.");

  return out;
}
