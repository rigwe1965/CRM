/**
 * Performance baseline (NEXT_LEVEL_PLAN.md, Phase 3). Read-only for your data: it builds a throwaway schema
 * `perf_test_…` inside TEST_DATABASE_URL, migrates it, fills it with synthetic businesses and contacts, times the
 * contact-list queries the API runs, and drops the schema again.
 *
 *   TEST_DATABASE_URL=... npx tsx scripts/perf-baseline.ts [--tenants 5] [--contacts 40000] [--keep]
 *
 * It connects as the database owner, so row-level security does not apply: the numbers are the query cost without
 * the policy check. Re-run against the restricted role before trusting small differences.
 */
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : fallback;
};
const TENANTS = arg("tenants", 5);
const CONTACTS = arg("contacts", 40000);
const KEEP = process.argv.includes("--keep");

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("TEST_DATABASE_URL is not set");
const schema = `perf_test_${randomBytes(5).toString("hex")}`;
const withSchema = (s: string) => {
  const u = new URL(base);
  u.searchParams.set("schema", s);
  return u.toString();
};

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))];

async function main() {
  const admin = new PrismaClient({ datasourceUrl: base });
  // pg_trgm belongs in public (see ensureTrigramExtension in tests/helpers/two-tenants.ts); one installed in the throwaway schema would be dropped with it.
  await admin.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public`).catch(() => undefined);
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await admin.$disconnect();
  const url = withSchema(schema);
  try {
    execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url, PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: "1" /* each run migrates its own throwaway schema; the lock is database-wide and only makes parallel test files queue */ }, stdio: "pipe" });
    const db = new PrismaClient({ datasourceUrl: url });

    console.log(`Filling ${TENANTS} businesses x ${CONTACTS} contacts = ${TENANTS * CONTACTS} contacts...`);
    const t0 = Date.now();
    await db.$executeRawUnsafe(
      `INSERT INTO "Tenant" (id, name, slug, "updatedAt") SELECT 'perf_t'||g, 'Perf '||g, 'perf-'||g, now() FROM generate_series(1,${TENANTS}) g`,
    );
    await db.$executeRawUnsafe(
      `INSERT INTO "User" (id, "tenantId", email, name, "updatedAt") SELECT 'perf_u'||g, 'perf_t'||g, 'admin'||g||'@perf.test', 'Admin '||g, now() FROM generate_series(1,${TENANTS}) g`,
    );
    await db.$executeRawUnsafe(
      `INSERT INTO "Contact" (id, "tenantId", "firstName", "lastName", email, phone, "ownerId", "deletedAt", "createdAt", "updatedAt")
       SELECT 'perf_c'||t||'_'||c, 'perf_t'||t,
              (ARRAY['Ada','Ngozi','Chioma','Amara','Zainab','Ifeoma','Funke','Tola','Bola','Kemi'])[1 + (c % 10)],
              (ARRAY['Okafor','Adeyemi','Bello','Eze','Musa','Obi','Nwosu','Ibrahim','Balogun','Uche'])[1 + ((c / 10) % 10)] || c,
              'c'||c||'@t'||t||'.test', '+23480'||lpad(c::text, 8, '0'), 'perf_u'||t,
              CASE WHEN c % 50 = 0 THEN now() END, now() - (c || ' minutes')::interval, now()
       FROM generate_series(1,${TENANTS}) t, generate_series(1,${CONTACTS}) c`,
    );
    await db.$executeRawUnsafe(`VACUUM ANALYZE "Contact"`); // as autovacuum would: index-only scans need the visibility map
    console.log(`Filled in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

    const tenantId = "perf_t1";
    const live = { tenantId, deletedAt: null };
    const cases: Array<[string, () => Promise<unknown>]> = [
      ["list, sorted by name, page 1", () => db.contact.findMany({ where: live, orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }], take: 25 })],
      ["list, sorted by createdAt desc, page 1", () => db.contact.findMany({ where: live, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 25 })],
      ["list, sorted by name, page 400 (offset 10000)", () => db.contact.findMany({ where: live, orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }], skip: 10000, take: 25 })],
      ["count of live contacts", () => db.contact.count({ where: live })],
      ["search 'okafor1' (contains, case-insensitive)", () => db.contact.findMany({ where: { ...live, OR: [{ lastName: { contains: "okafor1", mode: "insensitive" } }, { firstName: { contains: "okafor1", mode: "insensitive" } }, { email: { contains: "okafor1", mode: "insensitive" } }, { phone: { contains: "okafor1" } }] }, orderBy: [{ lastName: "asc" }, { id: "asc" }], take: 25 })],
      ["search by phone fragment", () => db.contact.findMany({ where: { ...live, phone: { contains: "0000123" } }, take: 25 })],
      ["owner-scoped list (ownerId = me)", () => db.contact.findMany({ where: { ...live, ownerId: "perf_u1" }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 25 })],
    ];

    const rows: string[] = [];
    for (const [name, run] of cases) {
      await run(); // warm up
      const times: number[] = [];
      for (let i = 0; i < 15; i++) {
        const s = process.hrtime.bigint();
        await run();
        times.push(Number(process.hrtime.bigint() - s) / 1e6);
      }
      rows.push(`${name.padEnd(50)} median ${median(times).toFixed(1).padStart(8)} ms   p95 ${p95(times).toFixed(1).padStart(8)} ms`);
    }
    console.log(rows.join("\n"));

    const plan = async (label: string, sql: string) => {
      const r = await db.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`);
      console.log(`\n--- ${label}\n${r.map((x) => x["QUERY PLAN"]).join("\n")}`);
    };
    await plan("sorted by name", `SELECT * FROM "Contact" WHERE "tenantId"='${tenantId}' AND "deletedAt" IS NULL ORDER BY "lastName","firstName",id LIMIT 25`);
    await plan("newest first", `SELECT * FROM "Contact" WHERE "tenantId"='${tenantId}' AND "deletedAt" IS NULL ORDER BY "createdAt" DESC, id LIMIT 25`);
    await plan("search", `SELECT * FROM "Contact" WHERE "tenantId"='${tenantId}' AND "deletedAt" IS NULL AND ("lastName" ILIKE '%okafor1%' OR "email" ILIKE '%okafor1%') ORDER BY "lastName",id LIMIT 25`);
    await db.$disconnect();
  } finally {
    if (!KEEP && /^perf_test_[0-9a-f]{10}$/.test(schema)) {
      const cleaner = new PrismaClient({ datasourceUrl: base });
      await cleaner.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      await cleaner.$disconnect();
    } else if (KEEP) console.log(`\nKept schema ${schema}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
