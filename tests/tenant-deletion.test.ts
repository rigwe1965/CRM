import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTenantDb } from "@/lib/tenant-db";
import { businessModels, createTwoTenants, delegateName, testDatabaseUrl, type TwoTenants } from "./helpers/two-tenants";

// Phase 5 of MULTI_TENANCY_PLAN.md on a real database with two businesses: asking for deletion, the grace period, the
// erasure itself, and the daily message caps.

const { holder, lazy, mail } = vi.hoisted(() => {
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
  return { holder, lazy, mail: [] as { to: string; subject: string; text: string }[] };
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
vi.mock("@/lib/mail", () => ({
  FROM: "CRM <noreply@x.test>",
  appUrl: () => "https://crm.test",
  mailIsConsoleOnly: () => false,
  trySendMail: vi.fn(async (m: { to: string; subject: string; text: string }) => (mail.push(m), true)),
  sendMail: vi.fn(async () => undefined),
}));

import * as deletion from "@/app/api/admin/tenant/deletion/route";
import { withTenant } from "@/lib/tenant-context";
import { eraseTenant, ERASE_ORDER, purgeDeletedTenants } from "@/lib/tenant-deletion";
import { assertUnderDailyCap } from "@/lib/usage-limits";

type Handler = (req: Request, ctx: { params: Promise<never> }) => Promise<Response>;
const session = (tenantId: string, id: string, role: "ADMIN" | "SALES") => ({ id, tenantId, role, tenantWritable: true, name: id, email: `${id}@x.test` });

async function call(handler: Handler, as: ReturnType<typeof session> | null, opts: { method?: string; body?: unknown } = {}) {
  holder.user = as;
  const res = await handler(
    new Request("http://x.test/api/admin/tenant/deletion", { method: opts.method ?? "GET", headers: { "Content-Type": "application/json" }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }),
    { params: Promise.resolve({} as never) },
  );
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as { data: { erasedOn: string; requestedAt: string } }) : undefined };
}

describe("erasure order", () => {
  it("names every business table, so a new table can't be left behind by a deletion", () => {
    const models = businessModels().map(delegateName);
    expect(models.filter((m) => !(ERASE_ORDER as readonly string[]).includes(m))).toEqual([]);
    expect(ERASE_ORDER.filter((m) => !models.includes(m))).toEqual([]);
  });
});

(testDatabaseUrl() ? describe : describe.skip)("deleting a business", () => {
  let t: TwoTenants;
  let a: ReturnType<typeof session>;
  let sales: ReturnType<typeof session>;

  beforeAll(async () => {
    t = await createTwoTenants();
    holder.db = createTenantDb(t.appDb);
    holder.platform = t.db;
    a = session(t.a.tenantId, t.a.admin, "ADMIN");
    sales = session(t.a.tenantId, t.a.sales, "SALES");
    // Fixtures are the unlimited internal plan, which can't be deleted; A becomes an ordinary paying customer.
    await t.db.tenant.update({ where: { id: t.a.tenantId }, data: { plan: "starter" } });
  }, 60_000);
  afterAll(async () => {
    holder.user = null;
    await t?.dispose();
  });
  beforeEach(() => {
    mail.length = 0;
  });
  const post = (as: typeof a | null, confirmName = "Tenant A") => call(deletion.POST as Handler, as, { method: "POST", body: { confirmName } });

  it("needs an admin and the business name typed exactly", async () => {
    expect((await post(sales)).status).toBe(403);
    expect((await post(a, "tenant a")).status).toBe(422);
    expect((await t.db.tenant.findUniqueOrThrow({ where: { id: t.a.tenantId } })).deletionRequestedAt).toBeNull();
  });

  it("starts a 30-day countdown, emails the admin, and can be taken back", async () => {
    const res = await post(a);
    expect(res.status).toBe(200);
    const days = (new Date(res.json!.data.erasedOn).getTime() - new Date(res.json!.data.requestedAt).getTime()) / 86_400_000;
    expect(days).toBe(30);
    expect(mail.map((m) => m.to)).toEqual([a.email]);
    expect((await post(a)).status).toBe(409);
    expect((await t.db.auditLog.findMany({ where: { tenantId: t.a.tenantId, action: "tenant.deletion.requested" } })).length).toBe(1);

    expect((await call(deletion.DELETE as Handler, a, { method: "DELETE" })).status).toBe(200);
    expect((await t.db.tenant.findUniqueOrThrow({ where: { id: t.a.tenantId } })).deletionRequestedAt).toBeNull();
    expect((await call(deletion.DELETE as Handler, a, { method: "DELETE" })).status).toBe(409);
  });

  it("refuses the internal business, which only the platform operator may remove", async () => {
    const b = session(t.b.tenantId, t.b.admin, "ADMIN");
    expect((await post(b, "Tenant B")).status).toBe(403);
    expect((await t.db.tenant.findUniqueOrThrow({ where: { id: t.b.tenantId } })).deletionRequestedAt).toBeNull();
    await expect(eraseTenant(t.b.tenantId)).rejects.toThrow(/internal/);
    expect(await t.db.tenant.count({ where: { id: t.b.tenantId } })).toBe(1);
  });

  it("keeps the audit log append-only: a delete is refused unless it is inside that business's own erasure", async () => {
    const del = (setting: string | null) =>
      t.db.$transaction(async (tx) => {
        if (setting) await tx.$executeRaw`SELECT set_config('app.erasing_tenant', ${setting}, true)`;
        await tx.auditLog.deleteMany({ where: { tenantId: t.b.tenantId } });
      });
    await expect(del(null)).rejects.toThrow(/append-only/);
    await expect(del(t.a.tenantId)).rejects.toThrow(/append-only/); // naming another business doesn't help
    expect(await t.db.auditLog.count({ where: { tenantId: t.b.tenantId } })).toBeGreaterThan(0);
  });

  it("erases nothing before the grace period is over, then every row of that business and none of the other's", async () => {
    await post(a);
    expect(await purgeDeletedTenants()).toEqual({ erased: 0, failed: 0 });
    expect(await t.db.tenant.count({ where: { id: t.a.tenantId } })).toBe(1);

    await t.db.tenant.update({ where: { id: t.a.tenantId }, data: { deletionRequestedAt: new Date(Date.now() - 31 * 86_400_000) } });
    expect(await purgeDeletedTenants()).toEqual({ erased: 1, failed: 0 });

    expect(await t.db.tenant.count({ where: { id: t.a.tenantId } })).toBe(0);
    for (const model of businessModels()) {
      const table = (t.db as unknown as Record<string, { count(a: object): Promise<number> }>)[delegateName(model)];
      expect(await table.count({ where: { tenantId: t.a.tenantId } }), `${model} of the erased business`).toBe(0);
      if (model !== "AuditLog") expect(await table.count({ where: { tenantId: t.b.tenantId } }), `${model} of the other business`).toBeGreaterThan(0);
    }
    expect(await t.db.tenant.count({ where: { id: t.b.tenantId } })).toBe(1);
    // One line records the erasure, without personal data.
    const line = await t.db.auditLog.findFirstOrThrow({ where: { action: "tenant.erased" } });
    expect(line).toMatchObject({ entityId: t.a.tenantId, summary: "Tenant A (tenant-a)" });
  });
});

(testDatabaseUrl() ? describe : describe.skip)("daily message caps", () => {
  let t: TwoTenants;
  beforeAll(async () => {
    t = await createTwoTenants();
    holder.db = createTenantDb(t.appDb);
    await t.db.tenant.update({ where: { id: t.a.tenantId }, data: { plan: "trial" } });
  }, 60_000);
  afterAll(async () => {
    await t?.dispose();
  });

  it("refuses the message past the plan's cap, per business and per kind, and never limits the internal plan", async () => {
    const inA = (kind: "emails" | "whatsapp") => withTenant(t.a.tenantId, () => assertUnderDailyCap(t.a.tenantId, kind));
    for (let i = 0; i < 50; i++) await inA("emails");
    await expect(inA("emails")).rejects.toMatchObject({ status: 429, code: "USAGE_LIMIT" });
    await inA("whatsapp"); // its own counter
    for (let i = 0; i < 60; i++) await withTenant(t.b.tenantId, () => assertUnderDailyCap(t.b.tenantId, "emails"));
  });
});
