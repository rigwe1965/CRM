import { readdirSync, readFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { DEFAULT_TENANT_ID } from "@/lib/tenant";
import { TENANTLESS_MODELS, businessModels } from "./helpers/two-tenants";

// Phase 0 of MULTI_TENANCY_PLAN.md: no database needed. Fails the moment someone adds a business table
// without a tenantId, so a table can never silently escape tenant scoping.

/** Business tables created after Phase 0, each with its tenantId from the start. */
const ADDED_LATER = ["TenantIntegration", "StockThreshold", "AiConversation", "AiMessage", "AiUsage", "AiProposal", "AiInboxRun", "AiTriage", "KnowledgeEntry", "KnowledgeEntryVersion", "WhatsappTemplate", "CustomerOrderLink", "Campaign", "CampaignRecipient"];

const models = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));

describe("tenant columns", () => {
  it("every business table carries a required tenantId with no default, so a create must name its business", () => {
    expect(businessModels().length).toBeGreaterThanOrEqual(20);
    for (const name of businessModels()) {
      const f = models.get(name)!.fields.find((x) => x.name === "tenantId");
      expect(f, `${name}.tenantId`).toBeDefined();
      expect(f).toMatchObject({ type: "String", isRequired: true, hasDefaultValue: false });
    }
  });

  it("every business table except the audit log is tied to its tenant by a foreign key", () => {
    for (const name of businessModels()) {
      const rel = models.get(name)!.fields.find((x) => x.name === "tenant");
      if (name === "AuditLog") expect(rel, "AuditLog has no foreign keys by design").toBeUndefined();
      else expect(rel, `${name}.tenant`).toMatchObject({ type: "Tenant", relationFromFields: ["tenantId"] });
    }
  });

  it("every business table has an index that starts with tenantId", () => {
    // The generated client's metadata doesn't list indexes, so read them from the schema file.
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    for (const name of businessModels()) {
      const block = schema.match(new RegExp(`\\nmodel ${name} \\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
      expect(/@@(index|unique)\(\[tenantId[,\]]/.test(block), `${name} needs @@index([tenantId, …]) or a unique that starts with it`).toBe(true);
    }
  });

  it("only the tables that belong to a user, and the tenant itself, are tenantless", () => {
    for (const name of TENANTLESS_MODELS) {
      expect(models.get(name)!.fields.some((f) => f.name === "tenantId"), name).toBe(false);
    }
    const all = [...models.keys()].sort();
    expect(all).toEqual([...businessModels(), ...TENANTLESS_MODELS].sort());
  });

  it("the migration creates the default tenant before any column points at it", () => {
    const sql = readFileSync("prisma/migrations/20261028000000_tenants/migration.sql", "utf8");
    const seedAt = sql.indexOf(`VALUES ('${DEFAULT_TENANT_ID}'`);
    expect(seedAt).toBeGreaterThan(-1);
    expect(sql.indexOf('ADD COLUMN "tenantId"')).toBeGreaterThan(seedAt);
    // Each business table that existed then gets exactly one column; the audit log has no foreign key. Tables added
    // later declare their tenantId in their own migration.
    const older = businessModels().filter((m) => !ADDED_LATER.includes(m));
    expect(sql.match(/ADD COLUMN "tenantId"/g)).toHaveLength(older.length);
    expect(sql.match(/_tenantId_fkey/g)).toHaveLength(older.length - 1);
  });
});

describe("row-level security (Phase 2)", () => {
  // Every migration, so a new table's policy is found wherever it is added; no list to forget to extend.
  const sql = () => readdirSync("prisma/migrations", { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => readFileSync(`prisma/migrations/${d.name}/migration.sql`, "utf8")).join("\n");

  it("every implicit many-to-many table between business tables has its own policy (it has no model, so the check above misses it)", () => {
    const migration = sql();
    const joins = Prisma.dmmf.datamodel.models.filter((m) => businessModels().includes(m.name)).flatMap((m) => m.fields.filter((f) => f.relationName && f.isList && models.get(f.type)?.fields.some((g) => g.relationName === f.relationName && g.isList)).map((f) => f.relationName));
    expect(joins.length).toBeGreaterThan(0);
    for (const rel of new Set(joins)) {
      expect(migration, `_${rel} RLS`).toContain(`ALTER TABLE "_${rel}" ENABLE ROW LEVEL SECURITY;`);
    }
  });

  it("every business table has RLS switched on and a policy that names its tenantId", () => {
    const migration = sql();
    for (const name of businessModels()) {
      expect(migration, `${name} RLS`).toContain(`ALTER TABLE "${name}" ENABLE ROW LEVEL SECURITY;`);
      const policy = migration.match(new RegExp(String.raw`CREATE POLICY tenant_isolation ON "${name}"([\s\S]*?);`))?.[1] ?? "";
      expect(policy, `${name} policy`).toContain(`"tenantId" = NULLIF(current_setting('app.tenant_id', true), '')`);
      expect(policy, `${name} write check`).toContain("WITH CHECK");
    }
  });

  it("the tenant table is readable only as itself, and the app role can't change it, the audit log or the sign-in tables", () => {
    const migration = sql();
    expect(migration).toContain('ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;');
    expect(migration).toContain('REVOKE INSERT, UPDATE, DELETE ON "Tenant" FROM crm_app');
    expect(migration).toContain('REVOKE UPDATE, DELETE ON "AuditLog" FROM crm_app');
    expect(migration).toContain('REVOKE ALL ON "Account", "Session", "VerificationToken" FROM crm_app');
  });

  it("every business table is granted to the app role: by the first RLS migration's blanket grant, or by its own migration", () => {
    const dirs = readdirSync("prisma/migrations", { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    const first = "20261031000000_row_level_security";
    const text = (d: string) => readFileSync(`prisma/migrations/${d}/migration.sql`, "utf8");
    const before = dirs.filter((d) => d < first).map(text).join("\n"); // tables the blanket GRANT ... ON ALL TABLES covered
    const all = sql();
    for (const name of businessModels()) {
      const covered = before.includes(`CREATE TABLE "${name}"`);
      const own = new RegExp(String.raw`GRANT[^;]*?ON\s+(?:"\w+",\s*)*"${name}"(?:,\s*"\w+")*\s+TO crm_app`).test(all);
      expect(covered || own, `${name} needs a GRANT ... ON "${name}" TO crm_app in its migration, or the app role cannot use it`).toBe(true);
    }
  });

  it("the policy is not forced on the table owner, so the platform client keeps working", () => {
    expect(sql()).not.toMatch(/FORCE ROW LEVEL SECURITY/);
  });

  it("the app role may edit only a business's presentation columns (and updatedAt, which Prisma writes), never its billing", () => {
    const grant = readFileSync("prisma/migrations/20261102000000_billing/migration.sql", "utf8").match(/GRANT UPDATE \(([^)]*)\) ON "Tenant"/)?.[1] ?? "";
    expect(grant.split(",").map((c) => c.trim().replaceAll('"', "")).sort()).toEqual(["brandName", "name", "senderName", "updatedAt"]);
  });
});
