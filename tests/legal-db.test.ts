import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LEGAL_VERSION } from "@/lib/legal";
import { createTenantDb } from "@/lib/tenant-db";
import { createTwoTenants, testDatabaseUrl, type TwoTenants } from "./helpers/two-tenants";

// Accepting the terms on a real database holding two businesses, with the real routes,
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

import * as legalRoute from "@/app/api/admin/legal/route";

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

run("accepting the terms on a real database", () => {
  let t: TwoTenants;
  beforeAll(async () => {
    t = await createTwoTenants();
    holder.db = createTenantDb(t.appDb);
    holder.platform = t.db;
  }, 180_000);
  afterAll(async () => {
    await t?.dispose();
  }, 60_000);
  beforeEach(() => {
    holder.user = null;
  });

  it("is for admins only", async () => {
    expect((await call(legalRoute.GET as Handler, session(t.a.tenantId, t.a.sales, "SALES"))).status).toBe(403);
    expect((await call(legalRoute.POST as Handler, session(t.a.tenantId, t.a.sales, "SALES"), { method: "POST" })).status).toBe(403);
  });

  it("starts not accepted, then records the version, who and when, for that business only", async () => {
    const admin = session(t.a.tenantId, t.a.admin, "ADMIN");
    expect((await call(legalRoute.GET as Handler, admin)).json.data).toMatchObject({ accepted: false, acceptedVersion: null });
    const res = await call(legalRoute.POST as Handler, admin, { method: "POST" });
    expect(res.json.data).toMatchObject({ accepted: true, acceptedVersion: LEGAL_VERSION });
    const stored = await t.db.automationSetting.findUniqueOrThrow({ where: { tenantId_key: { tenantId: t.a.tenantId, key: "legal" } } });
    expect(stored.config).toMatchObject({ version: LEGAL_VERSION, acceptedById: t.a.admin });
    const log = await t.db.auditLog.findFirstOrThrow({ where: { tenantId: t.a.tenantId, action: "legal.accepted" } });
    expect(log.data).toMatchObject({ version: LEGAL_VERSION });
    // Business B has not accepted just because A did.
    expect((await call(legalRoute.GET as Handler, session(t.b.tenantId, t.b.admin, "ADMIN"))).json.data).toMatchObject({ accepted: false });
  });

  it("asks again when the wording changes", async () => {
    const admin = session(t.a.tenantId, t.a.admin, "ADMIN");
    await t.db.automationSetting.update({ where: { tenantId_key: { tenantId: t.a.tenantId, key: "legal" } }, data: { config: { version: "2025-01-01", acceptedAt: new Date().toISOString(), acceptedById: t.a.admin } } });
    expect((await call(legalRoute.GET as Handler, admin)).json.data).toMatchObject({ accepted: false, acceptedVersion: "2025-01-01" });
  });
});
