import { z } from "zod";

/**
 * Production environment contract. Validated once at server start (src/instrumentation.ts) so a
 * misconfigured deployment fails immediately with a readable list instead of at the first request.
 */
const productionEnv = z
  .object({
    DATABASE_URL: z.string().trim().refine((v) => v.startsWith("postgres"), "must be a postgres:// URL"),
    NEXTAUTH_SECRET: z.string().optional(),
    AUTH_SECRET: z.string().optional(),
    NEXTAUTH_URL: z.string().optional(),
    VERCEL: z.string().optional(),
    AUTH_TRUST_HOST: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_SERVER: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
    CRON_SECRET: z.string().optional(),
    REQUIRE_ADMIN_MFA: z.enum(["0", "1", "true", "false", ""]).optional(),
    UPSTASH_REDIS_REST_URL: z.string().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const add = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    const secret = env.NEXTAUTH_SECRET || env.AUTH_SECRET;
    if (!secret) add("NEXTAUTH_SECRET", "required (generate with `npx auth secret`)");
    else if (secret.length < 32) add("NEXTAUTH_SECRET", "must be at least 32 characters");
    if (!env.RESEND_API_KEY && !env.EMAIL_SERVER) add("RESEND_API_KEY", "required (or EMAIL_SERVER for SMTP)");
    if (!env.EMAIL_FROM) add("EMAIL_FROM", 'required, e.g. "CRM <noreply@your-verified-domain.com>"');
    if (!env.CRON_SECRET || env.CRON_SECRET.length < 16) {
      add("CRON_SECRET", "required, at least 16 characters (protects /api/cron/*)");
    }
    if (!env.UPSTASH_REDIS_REST_URL) add("UPSTASH_REDIS_REST_URL", "required so rate limits are shared across instances");
    if (!env.UPSTASH_REDIS_REST_TOKEN) add("UPSTASH_REDIS_REST_TOKEN", "required together with UPSTASH_REDIS_REST_URL");
    if (!env.VERCEL && !env.NEXTAUTH_URL) add("NEXTAUTH_URL", "required outside Vercel (your public https URL)");
    if (!env.VERCEL && !env.AUTH_TRUST_HOST) add("AUTH_TRUST_HOST", "set to true when self-hosting behind your own domain");
  });

export function assertProductionEnv() {
  const result = productionEnv.safeParse(process.env);
  if (result.success) return;
  const lines = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
  throw new Error(`Invalid production environment:\n${lines.join("\n")}`);
}
