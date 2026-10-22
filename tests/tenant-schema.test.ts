import { readFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { DEFAULT_TENANT_ID } from "@/lib/tenant";
import { TENANTLESS_MODELS, businessModels } from "./helpers/two-tenants";

// Phase 0 of MULTI_TENANCY_PLAN.md: no database needed. Fails the moment someone adds a business table
// without a tenantId, so a table can never silently escape tenant scoping.

const models = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));

describe("tenant columns", () => {
  it("every business table carries a required tenantId that defaults to the original business", () => {
    expect(businessModels().length).toBeGreaterThanOrEqual(20);
    for (const name of businessModels()) {
      const f = models.get(name)!.fields.find((x) => x.name === "tenantId");
      expect(f, `${name}.tenantId`).toBeDefined();
      expect(f).toMatchObject({ type: "String", isRequired: true, hasDefaultValue: true, default: DEFAULT_TENANT_ID });
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
