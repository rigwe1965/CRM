import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * The one place that builds a Prisma client. Prisma 7 has no built-in database connection: every client is given a
 * driver adapter (node-postgres), so every `new PrismaClient()` in the app, the scripts and the tests goes through here.
 *
 * - `url`: the connection string; defaults to DATABASE_URL.
 * - `?schema=name` in the URL (used by the test harness, which builds a throwaway schema per test file) is taken out of
 *   the string and handed to the adapter, which qualifies the generated queries with it. The database's own functions
 *   (the same-business checks) look tables up unqualified, so a non-default schema also sets the session's search_path.
 *   That is skipped for the default "public" schema: Neon's pooled connections refuse extra startup options.
 * - connectionTimeoutMillis defaults to 5 s, which is what Prisma 6 used; node-postgres alone would wait forever.
 */
export type PrismaClientOptions = { url?: string; log?: Prisma.LogLevel[] };

const DEFAULT_LOG: Prisma.LogLevel[] = process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"];

export function adapterFor(url?: string) {
  const raw = url || process.env.DATABASE_URL;
  // Like Prisma 6, building a client never fails for a missing URL (build machines and many tests have none): the pool
  // only connects on the first query, and that is where a missing URL shows up.
  if (!raw) return new PrismaPg({ connectionTimeoutMillis: 5_000 });
  const u = new URL(raw);
  const schema = u.searchParams.get("schema") || undefined;
  u.searchParams.delete("schema");
  // Prisma-only URL parameters the node-postgres driver does not know about.
  for (const p of ["connection_limit", "pool_timeout", "pgbouncer", "connect_timeout", "socket_timeout"]) u.searchParams.delete(p);
  const nonDefault = schema && schema !== "public";
  return new PrismaPg(
    {
      connectionString: u.toString(),
      connectionTimeoutMillis: 5_000,
      ...(nonDefault && { options: `-c search_path=${schema},public` }),
    },
    schema ? { schema } : undefined,
  );
}

export function createPrismaClient(opts: PrismaClientOptions = {}) {
  return new PrismaClient({ adapter: adapterFor(opts.url), log: opts.log ?? DEFAULT_LOG });
}
