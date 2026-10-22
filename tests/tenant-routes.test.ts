import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTenantDb } from "@/lib/tenant-db";
import { businessModels, createTwoTenants, delegateName, testDatabaseUrl, type TwoTenants } from "./helpers/two-tenants";

// Phase 1 of MULTI_TENANCY_PLAN.md, the check that matters: with the real route handlers running on a real
// database that holds two businesses, a signed-in user of business A can't read, change, delete, export or link to
// business B's records, even holding B's ids. Needs TEST_DATABASE_URL (CI sets it); skipped without.
//
// Only the session is faked. The real `authed()` wrapper, the real queries and the real Postgres run. Since Phase 2
// the app's queries go through the real tenant client on a login that row-level security binds, so every handler
// here runs under both the application filters and the database's policies.

const { holder, lazy } = vi.hoisted(() => {
  const holder = { db: null as unknown, platform: null as unknown, user: null as unknown };
  /** A stand-in that forwards to whatever client the test has set up by the time a query runs. */
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
vi.mock("@/lib/platform-db", () => ({ platformDb: lazy(() => holder.platform) }));
vi.mock("@/lib/auth-helpers", async () => {
  const { hasRole } = await import("@/lib/rbac");
  const { apiError } = await import("@/lib/api");
  return {
    requireApiUser: async (...roles: string[]) => {
      const user = holder.user as { role: string } | null;
      if (!user) return { ok: false, response: apiError("Unauthorized", 401) };
      if (!hasRole(user.role as never, roles as never)) return { ok: false, response: apiError("Forbidden", 403) };
      return { ok: true, user };
    },
  };
});
vi.mock("@/lib/mail", () => ({ FROM: "CRM <noreply@x.test>", appUrl: () => "https://crm.test", trySendMail: vi.fn(async () => true), sendMail: vi.fn(async () => undefined) }));
vi.mock("@/lib/invite", () => ({ sendInvite: vi.fn(async () => ({ emailed: true })) }));

import * as activity from "@/app/api/activities/[id]/route";
import * as activities from "@/app/api/activities/route";
import * as auditList from "@/app/api/admin/audit/route";
import * as userInvite from "@/app/api/admin/users/[id]/invite/route";
import * as userMfaReset from "@/app/api/admin/users/[id]/mfa-reset/route";
import * as userRevoke from "@/app/api/admin/users/[id]/revoke-sessions/route";
import * as adminUser from "@/app/api/admin/users/[id]/route";
import * as adminUsers from "@/app/api/admin/users/route";
import * as contactConvert from "@/app/api/contacts/[id]/convert/route";
import * as contactMerge from "@/app/api/contacts/[id]/merge/route";
import * as contactRestore from "@/app/api/contacts/[id]/restore/route";
import * as contact from "@/app/api/contacts/[id]/route";
import * as contacts from "@/app/api/contacts/route";
import * as dashboard from "@/app/api/dashboard/route";
import * as dealPayment from "@/app/api/deals/[id]/payments/[paymentId]/route";
import * as dealPayments from "@/app/api/deals/[id]/payments/route";
import * as dealRestore from "@/app/api/deals/[id]/restore/route";
import * as deal from "@/app/api/deals/[id]/route";
import * as dealSchedule from "@/app/api/deals/[id]/schedule/route";
import * as dealStage from "@/app/api/deals/[id]/stage/route";
import * as deals from "@/app/api/deals/route";
import * as template from "@/app/api/email-templates/[id]/route";
import * as templates from "@/app/api/email-templates/route";
import * as exportCsv from "@/app/api/export/[entity]/route";
import * as invoice from "@/app/api/invoices/[id]/route";
import * as invoices from "@/app/api/invoices/route";
import * as organizationRestore from "@/app/api/organizations/[id]/restore/route";
import * as organization from "@/app/api/organizations/[id]/route";
import * as organizations from "@/app/api/organizations/route";
import * as savedFilter from "@/app/api/saved-filters/[id]/route";
import * as stockAdjustment from "@/app/api/stock/adjustments/[id]/route";
import * as tag from "@/app/api/tags/[id]/route";
import * as tags from "@/app/api/tags/route";
import * as task from "@/app/api/tasks/[id]/route";
import * as tasks from "@/app/api/tasks/route";

const run = testDatabaseUrl() ? describe : describe.skip;

type Handler = (req: Request, ctx: { params: Promise<never> }) => Promise<Response>;
const session = (tenantId: string, id: string, role: "ADMIN" | "SALES") => ({ id, tenantId, role, name: id, email: `${id}@x.test` });

async function call(handler: Handler, as: ReturnType<typeof session>, opts: { method?: string; body?: unknown; params?: Record<string, string>; url?: string } = {}) {
  holder.user = as;
  const method = opts.method ?? "GET";
  const res = await handler(
    new Request(opts.url ?? "http://x.test/api/x", { method, headers: { "Content-Type": "application/json" }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }),
    { params: Promise.resolve((opts.params ?? {}) as never) },
  );
  const text = await res.text();
  let json: { data?: unknown; code?: string } | undefined;
  try {
    json = JSON.parse(text);
  } catch {
    // CSV and empty bodies
  }
  return { status: res.status, json, text };
}

run("tenant isolation through the real routes", () => {
  let t: TwoTenants;
  let a: ReturnType<typeof session>; // business A's admin: the strongest caller a business has
  let aSales: ReturnType<typeof session>;
  let b: Record<string, string>; // ids that belong to business B
  const state: { before?: string } = {};

  /** Everything business B owns, as text, so "nothing changed" is a plain comparison. */
  const fingerprint = async (tenantId: string) => {
    const out: Record<string, unknown> = {};
    for (const model of businessModels()) {
      if (model === "AuditLog") continue;
      const delegate = (t.db as unknown as Record<string, { findMany: (a: object) => Promise<unknown[]> }>)[delegateName(model)];
      // Some tables (ContactTag) have no id to order by, so sort the rows as text.
      out[model] = (await delegate.findMany({ where: { tenantId } })).map((r) => JSON.stringify(r)).sort();
    }
    return JSON.stringify(out);
  };

  beforeAll(async () => {
    t = await createTwoTenants();
    holder.db = createTenantDb(t.appDb);
    holder.platform = t.db;
    a = session(t.a.tenantId, t.a.admin, "ADMIN");
    aSales = session(t.a.tenantId, t.a.sales, "SALES");
    const tid = t.b.tenantId;
    const [task_, act, adj, filter, template_, org] = await Promise.all([
      t.db.task.findFirstOrThrow({ where: { tenantId: tid } }),
      t.db.activity.findFirstOrThrow({ where: { tenantId: tid } }),
      t.db.stockAdjustment.findFirstOrThrow({ where: { tenantId: tid } }),
      t.db.savedFilter.findFirstOrThrow({ where: { tenantId: tid } }),
      t.db.emailTemplate.findFirstOrThrow({ where: { tenantId: tid } }),
      t.db.organization.findFirstOrThrow({ where: { tenantId: tid } }),
    ]);
    const payment = await t.db.payment.findFirstOrThrow({ where: { tenantId: tid } });
    // Soft-deleted rows an admin of the same business could restore.
    const deletedContact = await t.db.contact.create({ data: { tenantId: tid, firstName: "Gone", lastName: "B", deletedAt: new Date(), ownerId: t.b.sales } });
    const deletedDeal = await t.db.deal.create({ data: { tenantId: tid, title: "Gone B", amount: 1, ownerId: t.b.sales, deletedAt: new Date() } });
    const deletedOrg = await t.db.organization.create({ data: { tenantId: tid, name: "Gone B", ownerId: t.b.sales, deletedAt: new Date() } });
    const otherContact = await t.db.contact.create({ data: { tenantId: tid, firstName: "Other", lastName: "B", ownerId: t.b.sales } });
    b = {
      contact: t.b.contact, deal: t.b.deal, invoice: t.b.invoice, tag: t.b.tag, admin: t.b.admin, sales: t.b.sales, org: org.id,
      task: task_.id, activity: act.id, adjustment: adj.id, filter: filter.id, template: template_.id, payment: payment.id,
      deletedContact: deletedContact.id, deletedDeal: deletedDeal.id, deletedOrg: deletedOrg.id, otherContact: otherContact.id,
    };
  }, 180_000);
  afterAll(async () => {
    await t?.dispose();
  }, 60_000);
  beforeEach(() => {
    holder.user = null;
  });

  // ── By id: every way of reaching a record of business B is a plain "not found" ──────────────────────────────

  const id = (v: string) => ({ id: v });
  const cases: Array<[string, () => Handler, () => { method?: string; body?: unknown; params?: Record<string, string> }]> = [
    ["GET contact", () => contact.GET as Handler, () => ({ params: id(b.contact) })],
    ["PATCH contact", () => contact.PATCH as Handler, () => ({ method: "PATCH", body: { title: "hijacked" }, params: id(b.contact) })],
    ["DELETE contact", () => contact.DELETE as Handler, () => ({ method: "DELETE", params: id(b.contact) })],
    ["convert contact", () => contactConvert.POST as Handler, () => ({ method: "POST", params: id(b.contact) })],
    ["restore contact", () => contactRestore.POST as Handler, () => ({ method: "POST", params: id(b.deletedContact) })],
    ["merge B's contact away", () => contactMerge.POST as Handler, () => ({ method: "POST", body: { intoId: b.otherContact }, params: id(b.contact) })],
    ["GET deal", () => deal.GET as Handler, () => ({ params: id(b.deal) })],
    ["PATCH deal", () => deal.PATCH as Handler, () => ({ method: "PATCH", body: { title: "hijacked" }, params: id(b.deal) })],
    ["DELETE deal", () => deal.DELETE as Handler, () => ({ method: "DELETE", params: id(b.deal) })],
    ["move deal stage", () => dealStage.POST as Handler, () => ({ method: "POST", body: { stage: "CLOSED_WON" }, params: id(b.deal) })],
    ["restore deal", () => dealRestore.POST as Handler, () => ({ method: "POST", params: id(b.deletedDeal) })],
    ["list deal payments", () => dealPayments.GET as Handler, () => ({ params: id(b.deal) })],
    ["record a payment", () => dealPayments.POST as Handler, () => ({ method: "POST", body: { amount: 10, paidAt: new Date().toISOString() }, params: id(b.deal) })],
    ["delete a payment", () => dealPayment.DELETE as Handler, () => ({ method: "DELETE", params: { id: b.deal, paymentId: b.payment } })],
    ["replace the schedule", () => dealSchedule.PUT as Handler, () => ({ method: "PUT", body: { instalments: [] }, params: id(b.deal) })],
    ["GET invoice", () => invoice.GET as Handler, () => ({ params: id(b.invoice) })],
    ["PATCH invoice", () => invoice.PATCH as Handler, () => ({ method: "PATCH", body: { notes: "hijacked" }, params: id(b.invoice) })],
    ["DELETE invoice", () => invoice.DELETE as Handler, () => ({ method: "DELETE", params: id(b.invoice) })],
    ["GET organization", () => organization.GET as Handler, () => ({ params: id(b.org) })],
    ["PATCH organization", () => organization.PATCH as Handler, () => ({ method: "PATCH", body: { name: "hijacked" }, params: id(b.org) })],
    ["DELETE organization", () => organization.DELETE as Handler, () => ({ method: "DELETE", params: id(b.org) })],
    ["restore organization", () => organizationRestore.POST as Handler, () => ({ method: "POST", params: id(b.deletedOrg) })],
    ["rename tag", () => tag.PATCH as Handler, () => ({ method: "PATCH", body: { name: "hijacked" }, params: id(b.tag) })],
    ["DELETE tag", () => tag.DELETE as Handler, () => ({ method: "DELETE", params: id(b.tag) })],
    ["PATCH template", () => template.PATCH as Handler, () => ({ method: "PATCH", body: { name: "hijacked" }, params: id(b.template) })],
    ["DELETE template", () => template.DELETE as Handler, () => ({ method: "DELETE", params: id(b.template) })],
    ["DELETE saved filter", () => savedFilter.DELETE as Handler, () => ({ method: "DELETE", params: id(b.filter) })],
    ["GET task", () => task.GET as Handler, () => ({ params: id(b.task) })],
    ["PATCH task", () => task.PATCH as Handler, () => ({ method: "PATCH", body: { title: "hijacked" }, params: id(b.task) })],
    ["DELETE task", () => task.DELETE as Handler, () => ({ method: "DELETE", params: id(b.task) })],
    ["GET activity", () => activity.GET as Handler, () => ({ params: id(b.activity) })],
    ["PATCH activity", () => activity.PATCH as Handler, () => ({ method: "PATCH", body: { subject: "hijacked" }, params: id(b.activity) })],
    ["DELETE activity", () => activity.DELETE as Handler, () => ({ method: "DELETE", params: id(b.activity) })],
    ["PATCH stock adjustment", () => stockAdjustment.PATCH as Handler, () => ({ method: "PATCH", body: { quantity: 99 }, params: id(b.adjustment) })],
    ["DELETE stock adjustment", () => stockAdjustment.DELETE as Handler, () => ({ method: "DELETE", params: id(b.adjustment) })],
    ["demote B's admin", () => adminUser.PATCH as Handler, () => ({ method: "PATCH", body: { role: "SALES" }, params: id(b.admin) })],
    ["deactivate B's user", () => adminUser.PATCH as Handler, () => ({ method: "PATCH", body: { isActive: false }, params: id(b.sales) })],
    ["re-send B's invite", () => userInvite.POST as Handler, () => ({ method: "POST", params: id(b.sales) })],
    ["reset B's two-step verification", () => userMfaReset.POST as Handler, () => ({ method: "POST", params: id(b.admin) })],
    ["sign B's user out", () => userRevoke.POST as Handler, () => ({ method: "POST", params: id(b.sales) })],
  ];

  it.each(cases)("business A's admin gets 'not found' for B's record: %s", async (_label, handler, opts) => {
    const before = await fingerprint(t.b.tenantId);
    const res = await call(handler(), a, opts());
    expect(res.status, res.text).toBe(404);
    expect(await fingerprint(t.b.tenantId), "business B's data must be untouched").toBe(before);
  });

  // ── Links: B's ids can't be attached to A's records ─────────────────────────────────────────────────────────

  describe("linking to another business's records", () => {
    const refused = (res: { status: number; json?: { code?: string } }) => {
      expect(res.status).toBe(422);
      expect(res.json?.code).toBe("INVALID_REFERENCE");
    };

    it("a deal can't point at B's contact or organization", async () => {
      refused(await call(deals.POST as Handler, a, { method: "POST", body: { title: "x", contactId: b.contact }, params: {} }));
      refused(await call(deals.POST as Handler, a, { method: "POST", body: { title: "x", organizationId: b.org } }));
    });

    it("a contact can't be filed under B's organization, B's tag or B's user", async () => {
      refused(await call(contacts.POST as Handler, a, { method: "POST", body: { firstName: "X", lastName: "Y", organizationId: b.org } }));
      refused(await call(contacts.POST as Handler, a, { method: "POST", body: { firstName: "X", lastName: "Y", tagIds: [b.tag] } }));
      refused(await call(contacts.POST as Handler, a, { method: "POST", body: { firstName: "X", lastName: "Y", ownerId: b.sales } }));
      refused(await call(contact.PATCH as Handler, a, { method: "PATCH", body: { tagIds: [b.tag] }, params: id(t.a.contact) }));
    });

    it("tasks and activities can't link to B's records, or be assigned to B's users", async () => {
      refused(await call(tasks.POST as Handler, a, { method: "POST", body: { title: "x", dealId: b.deal } }));
      refused(await call(tasks.POST as Handler, a, { method: "POST", body: { title: "x", assigneeId: b.sales } }));
      refused(await call(activities.POST as Handler, a, { method: "POST", body: { subject: "x", contactId: b.contact } }));
      refused(await call(activity.PATCH as Handler, a, { method: "PATCH", body: { dealId: b.deal }, params: id((await t.db.activity.findFirstOrThrow({ where: { tenantId: t.a.tenantId } })).id) }));
    });

    it("an invoice can't be linked to B's deal", async () => {
      const body = { number: "INV-LINK", invoiceDate: new Date().toISOString(), vendorName: "S", billTo: "A", items: [{ ref: "1", style: "S", description: "d", quantity: 1, unitPrice: 1 }], dealIds: [b.deal] };
      refused(await call(invoices.POST as Handler, a, { method: "POST", body }));
    });

    it("a lead-form owner or record owner can't be one of B's users", async () => {
      refused(await call(deal.PATCH as Handler, a, { method: "PATCH", body: { ownerId: b.sales }, params: id(t.a.deal) }));
      refused(await call(organization.PATCH as Handler, a, { method: "PATCH", body: { ownerId: b.sales }, params: id((await t.db.organization.findFirstOrThrow({ where: { tenantId: t.a.tenantId } })).id) }));
    });
  });

  // ── Lists, dashboard, audit log, export: only A's rows ──────────────────────────────────────────────────────

  describe("what business A sees", () => {
    const rows = (res: { json?: { data?: unknown } }) => res.json?.data as Array<Record<string, unknown>>;
    const everyTenantIsA = (list: Array<Record<string, unknown>>) => {
      expect(list.length).toBeGreaterThan(0);
      for (const r of list) expect(r.tenantId ?? t.a.tenantId, JSON.stringify(r)).toBe(t.a.tenantId);
    };

    it.each([
      ["contacts", () => contacts.GET],
      ["deals", () => deals.GET],
      ["organizations", () => organizations.GET],
      ["invoices", () => invoices.GET],
      ["tasks", () => tasks.GET],
      ["activities", () => activities.GET],
      ["tags", () => tags.GET],
      ["email templates", () => templates.GET],
    ])("the %s list holds only A's rows", async (_name, h) => {
      const res = await call(h() as Handler, a);
      expect(res.status).toBe(200);
      everyTenantIsA(rows(res));
    });

    it("the user list, the audit log and the dashboard hold only A's data", async () => {
      const users = await call(adminUsers.GET as Handler, a);
      const emails = (users.json as unknown as { users: Array<{ email: string }> }).users.map((u) => u.email);
      expect(emails.sort()).toEqual(["admin-a@x.test", "sales-a@x.test"]);

      const audit = await call(auditList.GET as Handler, a, { url: "http://x.test/api/admin/audit?pageSize=100" });
      everyTenantIsA(rows(audit));
      expect(JSON.stringify(rows(audit))).not.toContain("fixture.b");

      const dash = await call(dashboard.GET as Handler, a);
      expect(dash.status).toBe(200);
      // A's single deal is 300 USD; B's must not be added in.
      expect(dash.text).not.toContain('"USD":600');
      // The raw SQL behind "money in" (cashflow.ts) names the business too: A recorded 100 USD, B another 100.
      expect(dash.text).toContain('"collected":{"total":{"USD":100}');
      expect(JSON.stringify(dash.json)).toContain("Customer a");
      expect(JSON.stringify(dash.json)).not.toContain("Customer b");
    });

    it("a CSV export holds only A's rows, for an admin and for a salesperson", async () => {
      for (const who of [a, aSales]) {
        // The contacts file is for admins only; exports are capped at 5 per user per 10 minutes.
        for (const entity of who === a ? ["contacts", "deals", "invoices"] : ["deals", "invoices"]) {
          const res = await call(exportCsv.GET as Handler, who, { params: { entity }, url: `http://x.test/api/export/${entity}` });
          expect(res.status, `${entity}: ${res.text.slice(0, 80)}`).toBe(200);
          expect(res.text).not.toMatch(/Customer b|Order b|INV-b-001|ada-b@x/);
        }
      }
      const mine = await call(exportCsv.GET as Handler, a, { params: { entity: "deals" }, url: "http://x.test/api/export/deals" });
      expect(mine.text).toContain("Order a");
    });

    it("a salesperson of A can't see B's records either (the owner rule still applies inside a business)", async () => {
      const res = await call(contact.GET as Handler, aSales, { params: id(b.contact) });
      expect(res.status).toBe(404);
    });
  });

  // ── Same names in two businesses ────────────────────────────────────────────────────────────────────────────

  describe("the same value in both businesses", () => {
    it("allows B's contact email, organization domain, tag name, template name and invoice number in A", async () => {
      const bContact = await t.db.contact.findUniqueOrThrow({ where: { id: b.contact } });
      const bOrg = await t.db.organization.findUniqueOrThrow({ where: { id: b.org } });
      const bTag = await t.db.tag.findUniqueOrThrow({ where: { id: b.tag } });
      const bTemplate = await t.db.emailTemplate.findUniqueOrThrow({ where: { id: b.template } });
      const bInvoice = await t.db.invoice.findUniqueOrThrow({ where: { id: b.invoice } });

      const c = await call(contacts.POST as Handler, a, { method: "POST", body: { firstName: "Same", lastName: "Email", email: bContact.email } });
      expect(c.status, c.text).toBe(201);
      const o = await call(organizations.POST as Handler, a, { method: "POST", body: { name: "Same", domain: bOrg.domain } });
      expect(o.status, o.text).toBe(201);
      const g = await call(tags.POST as Handler, a, { method: "POST", body: { name: bTag.name } });
      expect(g.status, g.text).toBe(201); // a new tag in A, not B's tag handed back
      expect((g.json?.data as { tenantId: string }).tenantId).toBe(t.a.tenantId);
      const m = await call(templates.POST as Handler, a, { method: "POST", body: { name: bTemplate.name, subject: "s", body: "b" } });
      expect(m.status, m.text).toBe(201);
      const i = await call(invoices.POST as Handler, a, {
        method: "POST",
        body: { number: bInvoice.number, invoiceDate: new Date().toISOString(), vendorName: "S", billTo: "A", items: [{ ref: "1", style: "S", description: "d", quantity: 1, unitPrice: 1 }] },
      });
      expect(i.status, i.text).toBe(201);
    });

    it("still refuses a duplicate inside one business", async () => {
      const dup = await call(tags.POST as Handler, a, { method: "POST", body: { name: "vip-a" } });
      expect(dup.status).toBe(200); // handed back the existing tag
      const again = await call(templates.POST as Handler, a, { method: "POST", body: { name: "Welcome a", subject: "s", body: "b" } });
      expect(again.status).toBe(409);
    });
  });

  // ── Everything A creates is filed under A, and its audit trail too ──────────────────────────────────────────

  it("rows created by A's user carry A's tenantId, including the audit entry", async () => {
    const created = await call(deals.POST as Handler, a, { method: "POST", body: { title: "Filed under A" }, url: "http://x.test/api/deals" });
    expect(created.status).toBe(201);
    const row = await t.db.deal.findFirstOrThrow({ where: { title: "Filed under A" } });
    expect(row.tenantId).toBe(t.a.tenantId);
    const entry = await t.db.auditLog.findFirst({ where: { action: "POST /api/deals", actorId: a.id }, orderBy: { createdAt: "desc" } });
    expect(entry).toBeTruthy();
    expect(entry?.tenantId).toBe(t.a.tenantId);
    const user = await call(adminUsers.POST as Handler, a, { method: "POST", body: { name: "New Person", email: "new-person@x.test", role: "SALES" } });
    expect(user.status).toBe(201);
    expect((await t.db.user.findUniqueOrThrow({ where: { email: "new-person@x.test" } })).tenantId).toBe(t.a.tenantId);
  });
});
