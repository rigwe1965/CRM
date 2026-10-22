import { readFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { DEFAULT_TENANT_ID } from "@/lib/tenant";
import { TENANTLESS_MODELS, businessModels } from "./helpers/two-tenants";

// Phase 0 of MULTI_TENANCY_PLAN.md: no database needed. Fails the moment someone adds a business table
// without a tenantId, so a table can never silently escape tenant scoping.

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
      expect(/@@index\(\[tenantId[,\]]/.test(block), `${name} needs @@index([tenantId, …])`).toBe(true);
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
    // Each business table gets exactly one column; the audit log has no foreign key.
    expect(sql.match(/ADD COLUMN "tenantId"/g)).toHaveLength(businessModels().length);
    expect(sql.match(/_tenantId_fkey/g)).toHaveLength(businessModels().length - 1);
  });
});

describe("row-level security (Phase 2)", () => {
  const sql = () => readFileSync("prisma/migrations/20261031000000_row_level_security/migration.sql", "utf8");

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

  it("the policy is not forced on the table owner, so the platform client keeps working", () => {
    expect(sql()).not.toMatch(/FORCE ROW LEVEL SECURITY/);
  });
});
