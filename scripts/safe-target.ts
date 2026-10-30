// Shared guard for commands that WIPE the database (the seed and `npm run db:reset`).
// Local databases pass. Anything else needs `--force` (or WIPE_FORCE=1) AND CONFIRM_WIPE=<database name>.

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]", "db", "postgres"];

type Env = Record<string, string | undefined>;

export function checkWipeTarget(env: Env, argv: string[]): { ok: true } | { ok: false; reason: string } {
  const url = env.DATABASE_URL ?? "";
  const parsed = URL.canParse(url) ? new URL(url) : null;
  const host = parsed?.hostname ?? "";
  const dbName = parsed?.pathname.replace(/^\//, "") ?? "";
  const local = LOCAL_HOSTS.includes(host);
  if (env.NODE_ENV !== "production" && local) return { ok: true };

  const forced = argv.includes("--force") || env.WIPE_FORCE === "1";
  if (forced && dbName && env.CONFIRM_WIPE === dbName) return { ok: true };
  return {
    ok: false,
    reason:
      `Refusing to wipe: DATABASE_URL host "${host || "unknown"}" is not local (or NODE_ENV=production).\n` +
      `This deletes all data. To go ahead on purpose, pass --force and set CONFIRM_WIPE to the database name` +
      `${dbName ? ` ("${dbName}")` : ""}.`,
  };
}

export function assertSafeTarget() {
  const result = checkWipeTarget(process.env, process.argv);
  if (!result.ok) {
    console.error(result.reason);
    process.exit(1);
  }
}
