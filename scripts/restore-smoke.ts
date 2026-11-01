// After a restore, proves the database still has the protections the app relies on, not just the right row counts.
//   npm run db:smoke -- "<restored url>"
// Checks: every migration finished; every table with a tenantId has row-level security on (and the tenant table too);
// the audit log refuses UPDATE. The last check inserts one audit row inside a transaction that is always rolled back.
// Exits 1 on any failure. Uses the owner role, like db:verify.
import { readdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const ROLLBACK = new Error("rollback");

async function main() {
  const url = process.argv[2];
  if (!url) throw new Error('Usage: npm run db:smoke -- "<restored database url>"');
  const prisma = new PrismaClient({ datasourceUrl: url });
  const failures: string[] = [];
  const pass = (m: string) => console.log(`ok   ${m}`);
  const fail = (m: string) => (failures.push(m), console.error(`FAIL ${m}`));

  try {
    // 1. Every migration in the repository was applied and finished.
    const expected = readdirSync("prisma/migrations", { withFileTypes: true }).filter((d) => d.isDirectory()).length;
    const [{ n, open }] = await prisma.$queryRaw<{ n: bigint; open: bigint }[]>`
      SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS n,
             count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS open FROM "_prisma_migrations"`;
    if (Number(n) === expected && Number(open) === 0) pass(`${expected} migrations applied and finished`);
    else fail(`migrations: ${Number(n)} finished of ${expected} in the repository, ${Number(open)} unfinished`);

    // 2. Row-level security is on for every business table and for the tenant table.
    const unprotected = await prisma.$queryRaw<{ relname: string }[]>`
      SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = current_schema() AND c.relkind = 'r' AND NOT c.relrowsecurity
        AND (c.relname = 'Tenant' OR c.relname IN (SELECT table_name FROM information_schema.columns WHERE table_schema = current_schema() AND column_name = 'tenantId'))`;
    if (unprotected.length === 0) pass("row-level security is on for every business table");
    else fail(`row-level security is OFF for: ${unprotected.map((r) => r.relname).join(", ")}`);

    // 3. The audit log is still append-only after the restore (triggers are not always carried over).
    const triggers = await prisma.$queryRaw<{ tgname: string }[]>`SELECT tgname FROM pg_trigger WHERE tgname IN ('AuditLog_append_only', 'AuditLog_no_truncate') AND NOT tgisinternal`;
    if (triggers.length === 2) pass("audit log triggers exist");
    else fail(`audit log triggers missing (found ${triggers.length} of 2)`);

    let refused = false;
    try {
      await prisma.$transaction(async (tx) => {
        const id = `smoke_${Date.now()}`;
        await tx.$executeRaw`INSERT INTO "AuditLog" ("id", "tenantId", "action") VALUES (${id}, 'smoke', 'restore.smoke')`;
        try {
          await tx.$executeRaw`UPDATE "AuditLog" SET "action" = 'changed' WHERE "id" = ${id}`;
        } catch {
          refused = true;
        }
        throw ROLLBACK; // nothing from this check is ever kept
      });
    } catch (e) {
      if (e !== ROLLBACK) throw e;
    }
    if (refused) pass("audit log refuses an UPDATE");
    else fail("audit log accepted an UPDATE: it is no longer append-only");
  } finally {
    await prisma.$disconnect();
  }

  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed. Do not rely on this restore.`);
    process.exit(1);
  }
  console.log("\nAll restore checks passed.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
