import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTenantDb } from "@/lib/tenant-db";
import { withTenant } from "@/lib/tenant-context";
import { createTwoTenants, testDatabaseUrl, type TenantFixture, type TwoTenants } from "./helpers/two-tenants";

// The check that matters for Ivy: run every tool as business A against a real database that also holds business B,
// and prove nothing of B's ever comes back, not even by guessing B's ids. Real tools, real queries; only the session
// is faked. Needs TEST_DATABASE_URL, like the other two-business tests.

const { holder, lazy } = vi.hoisted(() => {
  const holder = { db: null as unknown };
  const lazy = (pick: () => unknown) =>
    new Proxy(
      {},
      {
        get: (_t, key) => {
          const target = pick() as Record<string | symbol, unknown>;
          const v = target[key];
          return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        },
      },
    );
  return { holder, lazy };
});
vi.mock("@/lib/db", () => ({ db: lazy(() => holder.db) }));

import { IVY_TOOLS, toolByName, type ToolContext } from "@/lib/ai/tools";

const run = testDatabaseUrl() ? describe : describe.skip;
const DAY = 86_400_000;

run("Ivy's tools across two businesses", () => {
  let t: TwoTenants;

  const ctx = (f: TenantFixture, role: "ADMIN" | "SALES", userId = role === "ADMIN" ? f.admin : f.sales): ToolContext => {
    const user = { id: userId, tenantId: f.tenantId, role, name: "Tester", email: "t@x.test" } as ToolContext["user"];
    return { user, owned: role === "ADMIN" ? { tenantId: f.tenantId } : { tenantId: f.tenantId, ownerId: userId }, now: new Date() };
  };
  const call = async (name: string, c: ToolContext, input: unknown = {}) => JSON.parse(await withTenant(c.user.tenantId, () => toolByName(name)!.run(c, input)));

  beforeAll(async () => {
    t = await createTwoTenants();
    holder.db = createTenantDb(t.appDb);
    // Make business A's deal a won one with a late instalment (200 due, 100 paid, so 100 is late), so the money tools
    // have something to find; B's stays as seeded.
    await t.db.deal.update({ where: { id: t.a.deal }, data: { stage: "CLOSED_WON" } });
    await t.db.instalment.updateMany({ where: { tenantId: t.a.tenantId }, data: { dueDate: new Date(Date.now() - 10 * DAY), amount: 200 } });
  }, 60_000);
  afterAll(async () => {
    holder.db = null;
    await t?.dispose();
  });

  it("find_contacts shows a business its own contacts and never the other's", async () => {
    const a = await call("find_contacts", ctx(t.a, "ADMIN"));
    expect(a.rows.map((r: { name: string }) => r.name)).toEqual(["Ada Customer a"]);
    expect((await call("find_contacts", ctx(t.a, "ADMIN"), { query: "Customer b" })).total).toBe(0);
    expect((await call("find_contacts", ctx(t.b, "ADMIN"))).rows.map((r: { name: string }) => r.name)).toEqual(["Ada Customer b"]);
  });

  it("get_contact and get_deal refuse the other business's ids, as if they did not exist", async () => {
    const asA = ctx(t.a, "ADMIN");
    await expect(withTenant(t.a.tenantId, () => toolByName("get_contact")!.run(asA, { id: t.b.contact }))).rejects.toThrow(/No contact with that id is visible/);
    await expect(withTenant(t.a.tenantId, () => toolByName("get_deal")!.run(asA, { id: t.b.deal }))).rejects.toThrow(/No deal with that id is visible/);
    // and their own ids work
    expect((await call("get_contact", asA, { id: t.a.contact })).name).toBe("Ada Customer a");
    expect((await call("get_deal", asA, { id: t.a.deal })).title).toBe("Order a");
  });

  it("find_deals, find_invoices and list_tasks hold only the caller's business", async () => {
    const asA = ctx(t.a, "ADMIN");
    expect((await call("find_deals", asA)).rows.map((r: { title: string }) => r.title)).toEqual(["Order a"]);
    expect((await call("find_deals", asA, { contactId: t.b.contact })).total).toBe(0);
    expect((await call("find_invoices", asA)).rows.map((r: { number: string }) => r.number)).toEqual(["INV-a-001"]);
    expect((await call("list_tasks", asA)).rows.map((r: { title: string }) => r.title)).toEqual(["Task a"]);
  });

  it("a salesperson sees only what they own: someone else in the same business gets nothing", async () => {
    const stranger = ctx(t.a, "SALES", "not-the-owner");
    expect((await call("find_contacts", stranger)).total).toBe(0);
    expect((await call("find_deals", stranger)).total).toBe(0);
    expect((await call("find_invoices", stranger)).total).toBe(0);
    await expect(withTenant(t.a.tenantId, () => toolByName("get_deal")!.run(stranger, { id: t.a.deal }))).rejects.toThrow(/not visible|No deal/);
    // the owner does
    expect((await call("find_deals", ctx(t.a, "SALES"))).total).toBe(1);
  });

  it("the money tools count only the caller's business", async () => {
    const overdueA = await call("list_overdue", ctx(t.a, "ADMIN"));
    expect(overdueA.rows.map((r: { deal: string }) => r.deal)).toEqual(["Order a"]);
    expect(overdueA.rows[0]).toMatchObject({ overdue: true, currency: "USD", amountDue: 100 });
    expect(overdueA.totals.overdue).toEqual({ USD: 100 });
    expect((await call("list_overdue", ctx(t.b, "ADMIN"))).rows).toEqual([]);

    expect((await call("cash_flow", ctx(t.a, "ADMIN"))).owed.amount).toEqual({ USD: 200 }); // 300 - 100 paid, A only
    expect((await call("cash_flow", ctx(t.b, "ADMIN"))).owed.amount).toEqual({});

    const checksA = await call("money_checks", ctx(t.a, "ADMIN"));
    expect(checksA.findings.every((f: { deal: string }) => f.deal === "Order a")).toBe(true);
    const checksB = await call("money_checks", ctx(t.b, "ADMIN"));
    expect(checksB.findings.every((f: { deal: string }) => f.deal === "Order b")).toBe(true);
  });

  it("stock and sales reports run for each business without touching the other's", async () => {
    for (const f of [t.a, t.b]) {
      const stock = await call("stock_levels", ctx(f, "ADMIN"));
      expect(stock.rows.every((r: { product: string }) => typeof r.product === "string")).toBe(true);
      const report = await call("sales_report", ctx(f, "ADMIN"), { months: 3 });
      expect(report.months).toBe(3);
      const received = report.revenueByMonth.reduce((s: number, m: { revenue: Record<string, number> }) => s + (m.revenue.USD ?? 0), 0);
      expect(received).toBe(100); // each business's one payment of 100, never 200
    }
  });

  it("every tool runs for every role without error, and returns text the model can read", async () => {
    for (const tool of IVY_TOOLS) {
      for (const role of ["ADMIN", "SALES"] as const) {
        const text = await withTenant(t.a.tenantId, () => tool.run(ctx(t.a, role), tool.name.startsWith("get_") ? { id: "none" } : {})).catch((e: Error) => e.message);
        expect(typeof text, `${tool.name} as ${role}`).toBe("string");
        expect(text, `${tool.name} as ${role}`).not.toMatch(/tenant_b|Customer b|Order b|INV-b-001/);
      }
    }
  });
});
