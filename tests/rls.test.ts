import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenantDb, NoTenantContextError } from "@/lib/tenant-db";
import { withTenant } from "@/lib/tenant-context";
import { businessModels, createTwoTenants, delegateName, testDatabaseUrl, type TwoTenants } from "./helpers/two-tenants";

// Phase 2 of MULTI_TENANCY_PLAN.md, the check that matters: with every application filter removed, the database
// itself still refuses to show or change another business's rows. These queries deliberately carry no `where` on the
// tenant, which is the mistake the policies exist to survive. Needs TEST_DATABASE_URL and a test user who may create
// roles (CI has both); without that the suite skips itself.

const run = testDatabaseUrl() ? describe : describe.skip;

run("row-level security", () => {
  let t: TwoTenants;
  let db: ReturnType<typeof createTenantDb>;
  const asA = <T>(fn: () => Promise<T>) => withTenant(t.a.tenantId, fn);
  const asB = <T>(fn: () => Promise<T>) => withTenant(t.b.tenantId, fn);

  beforeAll(async () => {
    t = await createTwoTenants();
    db = createTenantDb(t.appDb);
  });
  afterAll(async () => {
    await t?.dispose();
  });

  /** Skips the test (instead of passing) when this machine's test user can't create the restricted login. */
  const needsRls = (ctx: { skip: () => void }) => {
    if (!t.rls) ctx.skip();
  };

  it("the app connection really is held back by the policies", async (ctx) => {
    needsRls(ctx);
    const [me] = await t.appDb.$queryRaw<{ super: boolean; bypass: boolean }[]>`SELECT rolsuper AS super, rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`;
    expect(me).toEqual({ super: false, bypass: false });
    // The owner/platform connection is not held back: it sees both businesses.
    expect(await t.db.contact.count()).toBe(2);
  });

  it("with no business set, every business table shows no rows at all", async (ctx) => {
    needsRls(ctx);
    for (const model of businessModels()) {
      const [row] = await t.appDb.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${model}"`);
      expect(Number(row.n), `${model} rows visible with no business`).toBe(0);
    }
  });

  it("an unfiltered read of any business table returns only the caller's rows", async (ctx) => {
    needsRls(ctx);
    for (const model of businessModels()) {
      const delegate = (db as unknown as Record<string, { findMany: (a?: object) => Promise<{ tenantId: string }[]> }>)[delegateName(model)];
      const mine = await asA(() => delegate.findMany());
      expect(mine.length, `${model}: A sees its own fixture row`).toBeGreaterThan(0);
      expect(new Set(mine.map((r) => r.tenantId)), `${model}: A sees only A`).toEqual(new Set([t.a.tenantId]));
      const theirs = await asB(() => delegate.findMany());
      expect(new Set(theirs.map((r) => r.tenantId)), `${model}: B sees only B`).toEqual(new Set([t.b.tenantId]));
    }
  });

  it("a business sees only its own tenant row", async (ctx) => {
    needsRls(ctx);
    expect((await asA(() => db.tenant.findMany())).map((x) => x.id)).toEqual([t.a.tenantId]);
  });

  it("an unfiltered update or delete touches only the caller's rows", async (ctx) => {
    needsRls(ctx);
    const before = await t.db.contact.findFirstOrThrow({ where: { tenantId: t.b.tenantId } });
    const changed = await asA(() => db.contact.updateMany({ data: { firstName: "Hijacked" } }));
    expect(changed.count).toBe(1);
    const after = await t.db.contact.findFirstOrThrow({ where: { tenantId: t.b.tenantId } });
    expect(after.firstName).toBe(before.firstName);

    const removed = await asA(() => db.activity.deleteMany());
    expect(removed.count).toBe(1);
    expect(await t.db.activity.count({ where: { tenantId: t.b.tenantId } })).toBe(1);
  });

  it("a write that names another business is refused by the database", async (ctx) => {
    needsRls(ctx);
    await expect(asA(() => db.tag.create({ data: { tenantId: t.b.tenantId, name: "planted" } }))).rejects.toThrow();
    // Moving one of its own rows into another business is refused too.
    await expect(asA(() => db.tag.updateMany({ data: { tenantId: t.b.tenantId } }))).rejects.toThrow();
    expect(await t.db.tag.count({ where: { name: "planted" } })).toBe(0);
  });

  it("holds inside interactive transactions, batches and raw queries", async (ctx) => {
    needsRls(ctx);
    const inTx = await asA(() => db.$transaction(async (tx) => tx.deal.findMany()));
    expect(inTx.map((d) => d.tenantId)).toEqual([t.a.tenantId]);

    const [deals, contacts] = await asA(() => db.$transaction([db.deal.findMany(), db.contact.findMany()]));
    expect([...deals, ...contacts].every((r) => r.tenantId === t.a.tenantId)).toBe(true);
    expect(deals.length + contacts.length).toBeGreaterThan(1);

    const raw = await asA(() => db.$queryRaw<{ tenantId: string }[]>`SELECT "tenantId" FROM "Deal"`);
    expect(raw).toEqual([{ tenantId: t.a.tenantId }]);

    // The row locks the payment code takes (SELECT ... FOR UPDATE) work under the policies too.
    const locked = await asA(() => db.$transaction(async (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Deal" WHERE id = ${t.a.deal} FOR UPDATE`));
    expect(locked).toHaveLength(1);
    const lockedOther = await asA(() => db.$transaction(async (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Deal" WHERE id = ${t.b.deal} FOR UPDATE`));
    expect(lockedOther).toHaveLength(0);
  });

  it("a rolled-back transaction leaves nothing behind", async (ctx) => {
    needsRls(ctx);
    await expect(
      asA(() =>
        db.$transaction(async (tx) => {
          await tx.tag.create({ data: { tenantId: t.a.tenantId, name: "temp" } });
          throw new Error("abort");
        }),
      ),
    ).rejects.toThrow("abort");
    expect(await t.db.tag.count({ where: { name: "temp" } })).toBe(0);
  });

  it("the setting never outlives a query, so a pooled connection carries nothing to the next caller", async (ctx) => {
    needsRls(ctx);
    // Many alternating and overlapping requests share the pool; each must see exactly its own business.
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => {
        const [as, id] = i % 2 ? [asA, t.a.tenantId] : [asB, t.b.tenantId];
        return as(() => db.contact.findMany()).then((rows) => rows.every((r) => r.tenantId === id) && rows.length === 1);
      }),
    );
    expect(results.every(Boolean)).toBe(true);
    // And a query made afterwards with no business set still sees nothing.
    const [row] = await t.appDb.$queryRaw<{ v: string | null }[]>`SELECT current_setting('app.tenant_id', true) AS v`;
    expect(row.v ?? "").toBe("");
    expect(await t.appDb.contact.count()).toBe(0);
  });

  it("a query outside any business context is refused before it reaches the database", async () => {
    await expect(db.contact.findMany()).rejects.toBeInstanceOf(NoTenantContextError);
    await expect(db.$transaction(async (tx) => tx.contact.findMany())).rejects.toBeInstanceOf(NoTenantContextError);
  });

  it("the app role can't edit the audit log, change a business, or read the sign-in tables", async (ctx) => {
    needsRls(ctx);
    await expect(asA(() => db.auditLog.updateMany({ data: { summary: "x" } }))).rejects.toThrow();
    await expect(asA(() => db.tenant.updateMany({ data: { name: "x" } }))).rejects.toThrow();
    await expect(asA(() => db.session.findMany())).rejects.toThrow();
    await expect(asA(() => db.account.findMany())).rejects.toThrow();
  });
});
