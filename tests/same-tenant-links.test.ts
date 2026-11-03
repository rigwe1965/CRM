import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TENANTLESS_MODELS, createTwoTenants, testDatabaseUrl, type TwoTenants } from "./helpers/two-tenants";

// CROSS_TENANT_LINKS_PLAN.md: the database itself refuses a row that points at another business's row. The links are
// read from the Prisma schema, so a new foreign key between business tables is covered automatically, and fails the
// catalog test below until its trigger exists. Needs TEST_DATABASE_URL (CI has it); without it the suite skips.

const closed = new Set<string>(TENANTLESS_MODELS);
const links = Prisma.dmmf.datamodel.models
  .filter((m) => !closed.has(m.name))
  .flatMap((m) => m.fields.filter((f) => f.relationFromFields?.length === 1 && !closed.has(f.type)).map((f) => ({ child: m.name, column: f.relationFromFields![0], parent: f.type })));

const run = testDatabaseUrl() ? describe : describe.skip;
const label = (l: (typeof links)[number]) => `${l.child}.${l.column} -> ${l.parent}`;

describe("the link list", () => {
  it("is found (no database needed)", () => {
    expect(links.length).toBeGreaterThanOrEqual(40);
    expect(new Set(links.map(label)).size).toBe(links.length);
  });
});

run("links between businesses, in the migrated database", () => {
  let t: TwoTenants;
  beforeAll(async () => {
    t = await createTwoTenants();
  });
  afterAll(async () => {
    await t?.dispose();
  });

  /** The fixture row of a business, as its physical address (some link tables, like ContactTag, have no "id"). */
  const one = async (table: string, tenantId: string) => {
    const rows = await t.db.$queryRawUnsafe<{ ref: string }[]>(`SELECT ctid::text AS ref FROM "${table}" WHERE "tenantId" = $1 ORDER BY ctid LIMIT 1`, tenantId);
    expect(rows.length, `fixture row in ${table} for ${tenantId}`).toBe(1);
    return rows[0].ref;
  };
  const idOf = async (table: string, ref: string) => (await t.db.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "${table}" WHERE ctid = $1::text::tid`, ref))[0].id;

  it("every foreign key between business tables has its trigger", async () => {
    const rows = await t.db.$queryRaw<{ child: string; col: string; trigger: string | null }[]>`
      SELECT cl.relname AS child, a.attname AS col,
        (SELECT tg.tgname FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
          WHERE tg.tgrelid = c.conrelid AND NOT tg.tgisinternal AND p.proname = 'enforce_same_tenant'
            AND tg.tgname = 'same_tenant_' || a.attname) AS trigger
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_class pl ON pl.oid = c.confrelid
      JOIN pg_namespace n ON n.oid = cl.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND n.nspname = current_schema() AND array_length(c.conkey, 1) = 1
        AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = c.conrelid AND x.attname = 'tenantId' AND NOT x.attisdropped)
        AND EXISTS (SELECT 1 FROM pg_attribute y WHERE y.attrelid = c.confrelid AND y.attname = 'tenantId' AND NOT y.attisdropped)`;
    expect(rows.length).toBe(links.length);
    expect(rows.filter((r) => !r.trigger).map((r) => `${r.child}.${r.col}`), "foreign keys with no same-business trigger").toEqual([]);
  });

  it("refuses to point any link at the other business's row, and accepts its own business's", async () => {
    for (const l of links) {
      const child = await one(l.child, t.a.tenantId);
      const own = await idOf(l.parent, await one(l.parent, t.a.tenantId));
      const foreign = await idOf(l.parent, await one(l.parent, t.b.tenantId));
      const set = (target: string) => t.db.$executeRawUnsafe(`UPDATE "${l.child}" SET "${l.column}" = $1 WHERE ctid = $2::text::tid`, target, child);

      await expect(set(foreign), `${label(l)} must refuse another business's row`).rejects.toThrow(/same business/);
      await expect(set(own), `${label(l)} must accept its own business's row`).resolves.toBeGreaterThanOrEqual(0);
    }
  });

  it("refuses an INSERT that points at another business, accepts the same INSERT inside one", async () => {
    const task = (contactId: string | null) =>
      t.db.task.create({ data: { tenantId: t.a.tenantId, title: "Link check", assigneeId: t.a.sales, createdById: t.a.sales, contactId } });
    // Prisma reports SQLSTATE 23503 (what the trigger raises, like a foreign key) as P2003 and drops the message.
    await expect(task(t.b.contact)).rejects.toMatchObject({ code: "P2003" });
    await expect(task(t.a.contact)).resolves.toMatchObject({ contactId: t.a.contact });
    await expect(task(null), "an empty link is fine").resolves.toMatchObject({ contactId: null });
  });

  it("refuses to move a row into another business while it still points at the first one's rows", async () => {
    await expect(t.db.$executeRawUnsafe(`UPDATE "Deal" SET "tenantId" = $1 WHERE "id" = $2`, t.b.tenantId, t.a.deal)).rejects.toThrow(/same business/);
    expect(await t.db.deal.count({ where: { id: t.a.deal, tenantId: t.a.tenantId } })).toBe(1);
  });

  it("does not get in the way of an update that touches no link", async () => {
    await expect(t.db.deal.update({ where: { id: t.a.deal }, data: { title: "Renamed" } })).resolves.toMatchObject({ title: "Renamed" });
  });
});
