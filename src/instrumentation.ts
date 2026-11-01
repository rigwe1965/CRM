export async function register() {
  // Skip during `next build` (build machines often have no runtime secrets) and on the edge runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production" || process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.SKIP_ENV_VALIDATION === "1") return;
  const { assertProductionEnv } = await import("@/lib/env");
  assertProductionEnv();
  // The database's second wall between businesses only holds if the app connects as a restricted role. A wrong
  // role breaks nothing visibly, so say so loudly at start instead (TECHNICIAN.md, "Row-level security").
  try {
    const { PrismaClient } = await import("@prisma/client");
    const { rowLevelSecurityWarning } = await import("@/lib/rls-check");
    const client = new PrismaClient();
    try {
      const warning = await rowLevelSecurityWarning(client);
      if (warning) console.error(`[security] ${warning}: businesses are separated by application filters only. See TECHNICIAN.md.`);
    } finally {
      await client.$disconnect();
    }
  } catch (e) {
    console.error("[security] row-level security check failed", e instanceof Error ? e.message : e);
  }
}

/**
 * Next.js calls this for every unhandled server error (a route that threw, a page that failed to render). It sends a
 * scrubbed report when SENTRY_DSN is set (src/lib/error-report.ts) and does nothing otherwise.
 */
export async function onRequestError(err: unknown, request: { path?: string; method?: string }, context: { routeType?: string }) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportError } = await import("@/lib/error-report");
  await reportError(err, { method: request?.method, path: request?.path, routeType: context?.routeType });
}
