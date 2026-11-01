import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTenantDb } from "@/lib/tenant-db";
import { createTwoTenants, testDatabaseUrl, type TwoTenants } from "./helpers/two-tenants";

// The customer import and the onboarding checklist on a real database holding two businesses, with the real routes,
// the real tenant client and row-level security. Needs TEST_DATABASE_URL (CI sets it); skipped without.

const { holder, lazy } = vi.hoisted(() => {
  const holder = { db: null as unknown, platform: null as unknown, user: null as unknown };
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

import * as importRoute from "@/app/api/contacts/import/route";
import * as onboardingRoute from "@/app/api/onboarding/route";

const run = testDatabaseUrl() ? describe : describe.skip;
type Handler = (req: Request, ctx: { params: Promise<never> }) => Promise<Response>;
const session = (tenantId: string, id: string, role: "ADMIN" | "SALES") => ({ id, tenantId, role, name: id, email: `${id}@x.test`, tenantWritable: true });

async function call(handler: Handler, as: ReturnType<typeof session>, opts: { method?: string; body?: unknown } = {}) {
  holder.user = as;
  const res = await handler(
    new Request("http://x.test/api/x", { method: opts.method ?? "GET", headers: { "Content-Type": "application/json" }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }),
    { params: Promise.resolve({} as never) },
  );
  const json = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>; code?: string };
  return { status: res.status, json };
}

run("customer import and onboarding on a real database", () => {
  let t: TwoTenants;
  let aSales: ReturnType<typeof session>;
  let aAdmin: ReturnType<typeof session>;

  beforeAll(async () => {
    t = await createTwoTenants();
    holder.db = createTenantDb(t.appDb);
    holder.platform = t.db;
    aSales = session(t.a.tenantId, t.a.sales, "SALES");
    aAdmin = session(t.a.tenantId, t.a.admin, "ADMIN");
  }, 180_000);
  afterAll(async () => {
    await t?.dispose();
  }, 60_000);
  beforeEach(() => {
    holder.user = null;
  });

  const rows = [
    { firstName: "Ngozi", lastName: "Eze", email: "ngozi@import.test", phone: "+234 803 555 0101", city: "Lagos", state: "", country: "NG" },
    { firstName: "Tunde", lastName: "-", email: "", phone: "", city: "", state: "", country: "" },
  ];

  it("needs a signed-in user", async () => {
    expect((await call(importRoute.POST as Handler, null as never, { method: "POST", body: { rows } })).status).toBe(401);
  });

  it("imports into the callers business only, owned by the importer, with consent left off", async () => {
    const res = await call(importRoute.POST as Handler, aSales, { method: "POST", body: { rows } });
    expect(res.status).toBe(201);
    expect(res.json.data).toMatchObject({ created: 2, skippedCount: 0 });
    const made = await t.db.contact.findMany({ where: { source: "Import" } });
    expect(made).toHaveLength(2);
    for (const c of made) expect(c).toMatchObject({ tenantId: t.a.tenantId, ownerId: t.a.sales, type: "CUSTOMER", whatsappOptIn: false, emailOptOut: false });
    expect(await t.db.contact.count({ where: { tenantId: t.b.tenantId, source: "Import" } })).toBe(0);
    expect(await t.db.auditLog.count({ where: { tenantId: t.a.tenantId, action: "contacts.imported" } })).toBe(1);
  });

  it("skips what the business already has, and does not treat the other business contacts as duplicates", async () => {
    const again = await call(importRoute.POST as Handler, aSales, { method: "POST", body: { rows } });
    expect(again.json.data).toMatchObject({ created: 0, skippedCount: 2 });
    // Business B has a contact with this email, which must not stop business A from adding its own.
    await t.db.contact.create({ data: { tenantId: t.b.tenantId, firstName: "Same", lastName: "Email", email: "shared@both.test", ownerId: t.b.sales } });
    const res = await call(importRoute.POST as Handler, aSales, { method: "POST", body: { rows: [{ firstName: "Same", lastName: "Email", email: "shared@both.test", phone: "", city: "", state: "", country: "" }] } });
    expect(res.json.data).toMatchObject({ created: 1 });
  });

  it("onboarding is for admins, reflects the business data, and can be hidden", async () => {
    expect((await call(onboardingRoute.GET as Handler, aSales)).status).toBe(403);
    const view = await call(onboardingRoute.GET as Handler, aAdmin);
    expect(view.status).toBe(200);
    const steps = Object.fromEntries((view.json.data!.steps as { key: string; done: boolean }[]).map((s) => [s.key, s.done]));
    expect(steps.customers).toBe(true);
    const hidden = await call(onboardingRoute.PUT as Handler, aAdmin, { method: "PUT", body: { dismissed: true } });
    expect(hidden.json.data).toMatchObject({ dismissed: true });
    // Hiding it for business A leaves business B alone.
    const bAdmin = session(t.b.tenantId, t.b.admin, "ADMIN");
    expect((await call(onboardingRoute.GET as Handler, bAdmin)).json.data).toMatchObject({ dismissed: false });
  });
});
