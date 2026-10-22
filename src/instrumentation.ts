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
