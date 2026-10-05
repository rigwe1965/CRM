export async function register() {
  // Skip during `next build` (build machines often have no runtime secrets) and on the edge runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production" || process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.SKIP_ENV_VALIDATION === "1") return;
  const { assertProductionEnv } = await import("@/lib/env");
  assertProductionEnv();
}
