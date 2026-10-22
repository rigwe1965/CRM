import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { businessModels, createTwoTenants, delegateName, testDatabaseUrl, type TwoTenants } from "./helpers/two-tenants";

// Needs a real Postgres: set TEST_DATABASE_URL (CI does). The suite builds its own throwaway schema and drops it,
// so it is safe next to real data. Without the variable the whole file is skipped.
const run = testDatabaseUrl() ? describe : describe.skip;

run("two-tenant fixtures (Phase 0 harness)", () => {
  let t: TwoTenants;
  beforeAll(async () => {
    t = await createTwoTenants();
  }, 180_000);
  afterAll(async () => {
    await t?.dispose();
  }, 60_000);

  it("fills every business table for both tenants, so a new table can't skip the isolation tests", async () => {
    for (const model of businessModels()) {
      const delegate = (t.db as unknown as Record<string, { count: (a: object) => Promise<number> }>)[delegateName(model)];
      for (const tenantId of [t.a.tenantId, t.b.tenantId]) {
        expect(await delegate.count({ where: { tenantId } }), `${model} rows for ${tenantId}`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps each tenant's rows apart", async () => {
    expect(await t.db.contact.count({ where: { tenantId: t.a.tenantId, id: t.b.contact } })).toBe(0);
    expect(await t.db.deal.count({ where: { tenantId: t.b.tenantId, id: t.a.deal } })).toBe(0);
    const aDeals = await t.db.deal.findMany({ where: { tenantId: t.a.tenantId } });
    expect(aDeals.map((d) => d.id)).toEqual([t.a.deal]);
  });

  it("refuses a row for a tenant that doesn't exist, and deleting a tenant that still has data", async () => {
    await expect(t.db.contact.create({ data: { firstName: "X", lastName: "Y", tenantId: "tenant_missing" } })).rejects.toMatchObject({ code: "P2003" });
    await expect(t.db.tenant.delete({ where: { id: t.a.tenantId } })).rejects.toMatchObject({ code: "P2003" });
  });

  it("still fills the original business when no tenant is given (until Phase 1 removes the default)", async () => {
    const c = await t.db.tenant.findUnique({ where: { id: "tenant_ivycandy" } });
    expect(c).toMatchObject({ slug: "ivycandy", status: "ACTIVE" });
    const contact = await t.db.contact.create({ data: { firstName: "D", lastName: "Default" } });
    expect(contact.tenantId).toBe("tenant_ivycandy");
  });

  it("keeps the audit log append-only", async () => {
    const row = await t.db.auditLog.findFirstOrThrow({ where: { tenantId: t.a.tenantId } });
    await expect(t.db.auditLog.update({ where: { id: row.id }, data: { action: "tampered" } })).rejects.toThrow(/append-only/);
  });

  // Phase 1 (route-level isolation) fills these in using the fixtures above.
  it.todo("tenant A's user can't list, read, edit, delete or export tenant B's records through any route");
  it.todo("guessing tenant B's ids in a link (contactId, dealId, organizationId, tagId) is refused");
  it.todo("the same email, domain, tag name, template name and invoice number can exist in both tenants");
  it.todo("raw SQL (cashflow, row locks) only sees the caller's tenant");
});
