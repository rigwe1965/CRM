import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTwoTenants, testDatabaseUrl, type TwoTenants } from "./helpers/two-tenants";

// Reads the migrated database's own catalog instead of the migration text: after every migration has run, each table
// in the schema must have row-level security on, a policy, and a grant to the app role (or be deliberately closed to
// it). Unlike tests/tenant-schema.test.ts this also sees tables that have no Prisma model (implicit join tables) and
// anything a later migration undid. Needs TEST_DATABASE_URL and a user who may create roles (CI has both).

/** Sign-in plumbing and platform data: only the platform client touches them, so the app role must have no access. */
const CLOSED_TO_APP_ROLE = ["Account", "Session", "VerificationToken", "JobRun"];
/** Bookkeeping tables that Prisma itself maintains. */
const SKIPPED = ["_prisma_migrations"];

const run = testDatabaseUrl() ? describe : describe.skip;

run("row-level security, as the migrated database has it", () => {
  let t: TwoTenants;
  let tables: string[] = [];

  beforeAll(async () => {
    t = await createTwoTenants();
    const rows = await t.db.$queryRaw<{ name: string }[]>`
      SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'p') ORDER BY 1`;
    tables = rows.map((r) => r.name).filter((n) => !SKIPPED.includes(n));
  });
  afterAll(async () => {
    await t?.dispose();
  });

  const needsRls = (ctx: { skip: () => void }) => {
    if (!t.rls) ctx.skip();
  };

  it("sees the schema's tables", () => {
    expect(tables.length).toBeGreaterThan(30);
    expect(tables).toContain("_DealToInvoice");
  });

  it("every table the app role may use has RLS switched on and at least one policy", async (ctx) => {
    needsRls(ctx);
    const rows = await t.db.$queryRaw<{ name: string; rls: boolean; policies: bigint }[]>`
      SELECT c.relname AS name, c.relrowsecurity AS rls,
        (SELECT count(*) FROM pg_policies p WHERE p.schemaname = n.nspname AND p.tablename = c.relname) AS policies
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'p')`;
    const open = rows.filter((r) => !SKIPPED.includes(r.name) && !CLOSED_TO_APP_ROLE.includes(r.name));
    expect(open.filter((r) => !r.rls).map((r) => r.name), "tables with RLS off").toEqual([]);
    expect(open.filter((r) => Number(r.policies) === 0).map((r) => r.name), "tables with no policy").toEqual([]);
  });

  it("every table the app role may use grants it SELECT, so a new table can't be left unusable", async (ctx) => {
    needsRls(ctx);
    const rows = await t.db.$queryRaw<{ name: string; ok: boolean }[]>`
      SELECT c.relname AS name, has_table_privilege('crm_app', c.oid, 'SELECT') AS ok
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'p')`;
    const open = rows.filter((r) => !SKIPPED.includes(r.name) && !CLOSED_TO_APP_ROLE.includes(r.name));
    expect(open.filter((r) => !r.ok).map((r) => r.name), "tables crm_app cannot read").toEqual([]);
  });

  it("the sign-in and platform tables are closed to the app role in every way", async (ctx) => {
    needsRls(ctx);
    for (const name of CLOSED_TO_APP_ROLE) {
      const [row] = await t.db.$queryRawUnsafe<{ any: boolean }[]>(
        `SELECT (has_table_privilege('crm_app', '"${name}"', 'SELECT') OR has_table_privilege('crm_app', '"${name}"', 'INSERT')
              OR has_table_privilege('crm_app', '"${name}"', 'UPDATE') OR has_table_privilege('crm_app', '"${name}"', 'DELETE')) AS any`,
      );
      expect(row.any, `${name} must not be reachable by crm_app`).toBe(false);
    }
  });

  it("the app role can't write the tenant table (beyond its presentation columns), edit or delete the audit log, or alter the schema", async (ctx) => {
    needsRls(ctx);
    const priv = async (table: string, p: string) =>
      (await t.db.$queryRawUnsafe<{ ok: boolean }[]>(`SELECT has_table_privilege('crm_app', '"${table}"', '${p}') AS ok`))[0].ok;
    expect(await priv("Tenant", "INSERT")).toBe(false);
    expect(await priv("Tenant", "UPDATE")).toBe(false); // table-wide; only named columns are granted
    expect(await priv("Tenant", "DELETE")).toBe(false);
    expect(await priv("AuditLog", "UPDATE")).toBe(false);
    expect(await priv("AuditLog", "DELETE")).toBe(false);
    const [schema] = await t.db.$queryRaw<{ create: boolean }[]>`SELECT has_schema_privilege('crm_app', current_schema(), 'CREATE') AS "create"`;
    expect(schema.create, "crm_app must not be able to create objects").toBe(false);
  });

  it("a policy on a table with a tenantId names it", async (ctx) => {
    needsRls(ctx);
    const rows = await t.db.$queryRaw<{ name: string; qual: string | null; check: string | null }[]>`
      SELECT p.tablename AS name, p.qual, p.with_check AS "check" FROM pg_policies p
      WHERE p.schemaname = current_schema() AND EXISTS (
        SELECT 1 FROM information_schema.columns k
        WHERE k.table_schema = p.schemaname AND k.table_name = p.tablename AND k.column_name = 'tenantId')`;
    expect(rows.length).toBeGreaterThan(30);
    for (const r of rows) {
      // The tenant table itself compares its own "id"; every other table compares "tenantId".
      expect(r.qual ?? "", `${r.name} USING`).toMatch(r.name === "Tenant" ? /id/ : /tenantId/);
      if (r.name !== "Tenant") expect(r.check ?? "", `${r.name} WITH CHECK`).toMatch(/tenantId/);
    }
  });
});
