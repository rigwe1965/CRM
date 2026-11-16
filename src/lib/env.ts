import { z } from "zod";
import { validEmail, validHttpsUrl } from "@/lib/support";

/**
 * Production environment contract. Validated once at server start (src/instrumentation.ts) so a
 * misconfigured deployment fails immediately with a readable list instead of at the first request.
 */
const productionEnv = z
  .object({
    DATABASE_URL: z.string().trim().refine((v) => v.startsWith("postgres"), "must be a postgres:// URL"),
    PLATFORM_DATABASE_URL: z.string().trim().refine((v) => v === "" || v.startsWith("postgres"), "must be a postgres:// URL").optional(),
    NEXTAUTH_SECRET: z.string().optional(),
    AUTH_SECRET: z.string().optional(),
    NEXTAUTH_URL: z.string().optional(),
    VERCEL: z.string().optional(),
    TRUSTED_PROXY_COUNT: z.string().refine((v) => v === "" || /^[1-9]\d?$/.test(v), "must be a whole number from 1 to 99 (how many reverse proxies are in front of the app)").optional(),
    AUTH_TRUST_HOST: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_SERVER: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
    CRON_SECRET: z.string().optional(),
    SENTRY_DSN: z.string().refine((v) => v === "" || (URL.canParse(v) && v.startsWith("https://") && !!new URL(v).username), "must be a Sentry DSN: https://<key>@<host>/<project number>").optional(),
    SENTRY_ENVIRONMENT: z.string().optional(),
    HEALTHCHECK_PING_URL: z.string().refine((v) => v === "" || (URL.canParse(v) && v.startsWith("https://")), "must be an https:// URL").optional(),
    ALLOW_UNRESTRICTED_DB_ROLE: z.string().optional(),
    LEGAL_ENTITY_NAME: z.string().optional(),
    LEGAL_ADDRESS: z.string().optional(),
    LEGAL_GOVERNING_LAW: z.string().optional(),
    LEGAL_REVIEWED: z.enum(["0", "1", ""]).optional(),
    SUPPORT_EMAIL: z.string().refine((v) => v === "" || validEmail(v), "must be an email address").optional(),
    SECURITY_EMAIL: z.string().refine((v) => v === "" || validEmail(v), "must be an email address").optional(),
    STATUS_PAGE_URL: z.string().refine((v) => v === "" || validHttpsUrl(v), "must be an https:// URL").optional(),
    MFA_ENCRYPTION_KEY: z.string().optional(),
    MFA_ENCRYPTION_KEY_PREVIOUS: z.string().optional(),
    REQUIRE_ADMIN_MFA: z.enum(["0", "1", "true", "false", ""]).optional(),
    UPSTASH_REDIS_REST_URL: z.string().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
    SIGNUP_ENABLED: z.string().optional(),
    SIGNUP_DEV_LINKS: z.string().optional(),
    TURNSTILE_SITE_KEY: z.string().optional(),
    TURNSTILE_SECRET_KEY: z.string().optional(),
    BILLING_STRIPE_SECRET_KEY: z.string().optional(),
    BILLING_STRIPE_WEBHOOK_SECRET: z.string().optional(),
    BILLING_PRICE_STARTER: z.string().optional(),
    BILLING_PRICE_PRO: z.string().optional(),
    BILLING_AUTOMATIC_TAX: z.string().optional(),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_APP_SECRET: z.string().optional(),
    WHATSAPP_VERIFY_TOKEN: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    // Included AI (INCLUDED_AI_PLAN.md): the platform's own key, and the dollars of AI each plan includes per month. All off when unset.
    INCLUDED_AI_ANTHROPIC_KEY: z.string().optional(),
    INCLUDED_AI_ALLOWANCE_TRIAL: z.string().optional(),
    INCLUDED_AI_ALLOWANCE_STARTER: z.string().optional(),
    INCLUDED_AI_ALLOWANCE_PRO: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const add = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    const secret = env.NEXTAUTH_SECRET || env.AUTH_SECRET;
    if (!secret) add("NEXTAUTH_SECRET", "required (generate with `npx auth secret`)");
    else if (secret.length < 32) add("NEXTAUTH_SECRET", "must be at least 32 characters");
    if (!env.RESEND_API_KEY && !env.EMAIL_SERVER) add("RESEND_API_KEY", "required (or EMAIL_SERVER for SMTP)");
    if (!env.EMAIL_FROM) add("EMAIL_FROM", 'required, e.g. "CRM <noreply@your-verified-domain.com>"');
    for (const name of ["MFA_ENCRYPTION_KEY", "MFA_ENCRYPTION_KEY_PREVIOUS"] as const) {
      if (env[name] && Buffer.from(env[name]!, "base64").length < 32) add(name, "must be at least 32 random bytes, base64 encoded (openssl rand -base64 32)");
    }
    if (!env.MFA_ENCRYPTION_KEY) add("MFA_ENCRYPTION_KEY", "required: it encrypts every business's saved Stripe, WhatsApp and Anthropic keys and the two-step secrets (openssl rand -base64 32). Without it they hang on NEXTAUTH_SECRET alone");
    if (!env.PLATFORM_DATABASE_URL && env.ALLOW_UNRESTRICTED_DB_ROLE !== "1") add("PLATFORM_DATABASE_URL", "required: DATABASE_URL must connect as the restricted role and this one as the owner (see TECHNICIAN.md, Row-level security)");
    if (!env.CRON_SECRET || env.CRON_SECRET.length < 16) {
      add("CRON_SECRET", "required, at least 16 characters (protects /api/cron/*)");
    }
    if (!env.UPSTASH_REDIS_REST_URL) add("UPSTASH_REDIS_REST_URL", "required so rate limits are shared across instances");
    if (!env.UPSTASH_REDIS_REST_TOKEN) add("UPSTASH_REDIS_REST_TOKEN", "required together with UPSTASH_REDIS_REST_URL");
    // Billing is optional, but a half setup would let businesses subscribe without us hearing about it.
    if (env.BILLING_STRIPE_SECRET_KEY && !env.BILLING_STRIPE_WEBHOOK_SECRET) add("BILLING_STRIPE_WEBHOOK_SECRET", "required together with BILLING_STRIPE_SECRET_KEY");
    if (env.BILLING_STRIPE_WEBHOOK_SECRET && !env.BILLING_STRIPE_SECRET_KEY) add("BILLING_STRIPE_SECRET_KEY", "required together with BILLING_STRIPE_WEBHOOK_SECRET");
    if (env.BILLING_STRIPE_SECRET_KEY && !/^(sk|rk)_(test|live)_/.test(env.BILLING_STRIPE_SECRET_KEY)) add("BILLING_STRIPE_SECRET_KEY", "must be a Stripe secret or restricted key (sk_… or rk_…)");
    if ((env.SIGNUP_ENABLED === "1" || env.SIGNUP_ENABLED === "true") && !env.BILLING_STRIPE_SECRET_KEY) add("BILLING_STRIPE_SECRET_KEY", "required when SIGNUP_ENABLED is on, or trials end with no way to pay");
    // The CAPTCHA keys come as a pair, and public sign-up without one invites bots.
    if (env.TURNSTILE_SITE_KEY && !env.TURNSTILE_SECRET_KEY) add("TURNSTILE_SECRET_KEY", "required together with TURNSTILE_SITE_KEY");
    if (env.TURNSTILE_SECRET_KEY && !env.TURNSTILE_SITE_KEY) add("TURNSTILE_SITE_KEY", "required together with TURNSTILE_SECRET_KEY");
    if ((env.SIGNUP_ENABLED === "1" || env.SIGNUP_ENABLED === "true") && !env.TURNSTILE_SECRET_KEY) add("TURNSTILE_SECRET_KEY", "required when SIGNUP_ENABLED is on, so bots can't mass-create businesses (Cloudflare Turnstile)");
    // Online payments are optional, but half a setup would take payments the CRM can't record.
    if (env.STRIPE_SECRET_KEY && !env.STRIPE_WEBHOOK_SECRET) add("STRIPE_WEBHOOK_SECRET", "required together with STRIPE_SECRET_KEY");
    if (env.STRIPE_WEBHOOK_SECRET && !env.STRIPE_SECRET_KEY) add("STRIPE_SECRET_KEY", "required together with STRIPE_WEBHOOK_SECRET");
    if (env.STRIPE_SECRET_KEY && !/^(sk|rk)_(test|live)_/.test(env.STRIPE_SECRET_KEY)) add("STRIPE_SECRET_KEY", "must be a Stripe secret or restricted key (sk_… or rk_…)");
    // Two-way WhatsApp is optional, but a half setup would accept messages it can't verify or answer.
    const wa = ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"] as const;
    if (wa.some((k) => env[k]) && !wa.every((k) => env[k])) {
      for (const k of wa) if (!env[k]) add(k, "required together with the other WHATSAPP_ settings");
    }
    if (env.WHATSAPP_VERIFY_TOKEN && env.WHATSAPP_VERIFY_TOKEN.length < 16) add("WHATSAPP_VERIFY_TOKEN", "must be at least 16 characters");
    if (env.SIGNUP_DEV_LINKS === "1") add("SIGNUP_DEV_LINKS", "must not be set in production (it would put the signup confirmation link in the response)");
    if (!env.VERCEL && !env.NEXTAUTH_URL) add("NEXTAUTH_URL", "required outside Vercel (your public https URL)");
    if (!env.VERCEL && !env.AUTH_TRUST_HOST) add("AUTH_TRUST_HOST", "set to true when self-hosting behind your own domain");
  });

export function assertProductionEnv() {
  const result = productionEnv.safeParse(process.env);
  if (result.success) {
    for (const w of productionWarnings(process.env)) console.warn(`[env] ${w}`);
    return;
  }
  const lines = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
  throw new Error(`Invalid production environment:\n${lines.join("\n")}`);
}

/** Settings that are allowed but worth a second look. Logged at start-up; they never stop the server. */
export function productionWarnings(env: Record<string, string | undefined>): string[] {
  const warnings: string[] = [];
  if (!env.VERCEL && !env.TRUSTED_PROXY_COUNT) {
    warnings.push("TRUSTED_PROXY_COUNT is not set, so rate limits assume exactly one reverse proxy in front of the app. Set it to the real number, and keep the app unreachable except through the proxy.");
  }
  if (env.LEGAL_REVIEWED !== "1") warnings.push("LEGAL_REVIEWED is not 1, so the terms, privacy policy and data processing addendum still show a draft notice. Set it only after a lawyer has approved them and LEGAL_ENTITY_NAME, LEGAL_ADDRESS and LEGAL_GOVERNING_LAW are filled in.");
  if (!validEmail(env.SUPPORT_EMAIL)) warnings.push("SUPPORT_EMAIL is not set, so customers are shown no way to reach you and /.well-known/security.txt does not exist. Set it to an address you read every day.");
  return warnings;
}
