import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTenantDb } from "@/lib/tenant-db";
import { createTwoTenants, testDatabaseUrl, type TwoTenants } from "./helpers/two-tenants";

// The sender address per business, on a real database with two businesses. The email provider (Resend) is replaced by a
// fake that remembers which domains exist and which have been verified.

const { holder, lazy, provider } = vi.hoisted(() => {
  process.env.EMAIL_FROM = "CRM <noreply@platform.test>"; // read when the mail module loads
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
  const provider = { domains: new Map<string, { name: string; verified: boolean }>(), n: 0, rejects: false };
  return { holder, lazy, provider };
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
vi.mock("resend", () => ({
  Resend: class {
    domains = {
      create: async ({ name }: { name: string }) => {
        if (provider.rejects) return { data: null, error: { name: "validation_error", message: "domain already registered" } };
        const id = `dom_${++provider.n}`;
        provider.domains.set(id, { name, verified: false });
        return { data: { id, name, status: "not_started", records: [] }, error: null };
      },
      get: async (id: string) => {
        const d = provider.domains.get(id);
        if (!d) return { data: null, error: { name: "not_found", message: "no" } };
        return { data: { id, name: d.name, status: d.verified ? "verified" : "pending", records: [{ record: "SPF", type: "TXT", name: "send", value: "v=spf1 include:x ~all", ttl: "Auto", status: "pending" }, { record: "DKIM", type: "CNAME", name: "k._domainkey", value: "k.dkim.x", ttl: "Auto", status: "pending" }, { record: "Receiving", type: "MX", name: "@", value: "mx", ttl: "Auto", status: "pending" }] }, error: null };
      },
      verify: async (id: string) => ({ data: { id }, error: null }),
      remove: async (id: string) => (provider.domains.delete(id), { data: { id }, error: null }),
    };
  },
}));

import * as senderRoute from "@/app/api/admin/tenant/sender/route";
import * as verifyRoute from "@/app/api/admin/tenant/sender/verify/route";
import { checkSender, senderFor } from "@/lib/sender";
import { withTenant } from "@/lib/tenant-context";

type Handler = (req: Request, ctx: { params: Promise<never> }) => Promise<Response>;
const session = (tenantId: string, id: string, role: "ADMIN" | "SALES") => ({ id, tenantId, role, tenantWritable: true, name: id, email: `${id}@x.test` });
async function call(handler: Handler, as: ReturnType<typeof session> | null, opts: { method?: string; body?: unknown } = {}) {
  holder.user = as;
  const res = await handler(new Request("http://x.test/api/admin/tenant/sender", { method: opts.method ?? "GET", headers: { "Content-Type": "application/json" }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), { params: Promise.resolve({} as never) });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as { data?: Record<string, unknown>; code?: string }) : undefined };
}

describe("checking an address", () => {
  it("accepts a normal domain and lowercases it", () => {
    expect(checkSender({ domain: " Mail.Shop.com ", localPart: "Hello" })).toEqual({ domain: "mail.shop.com", localPart: "hello" });
  });
  it("refuses what a business can't own or what isn't a domain", () => {
    for (const domain of ["gmail.com", "Outlook.com", "https://shop.com", "shop", "a@shop.com", "shop.com/x", "-bad.com", "shop..com"]) {
      expect(() => checkSender({ domain, localPart: "hello" }), domain).toThrow();
    }
    for (const localPart of ["", "a b", "a@b", "x..y", ".x", "x\r\nBcc: z", '"quoted"']) {
      expect(() => checkSender({ domain: "shop.com", localPart }), localPart).toThrow();
    }
  });
});

(testDatabaseUrl() ? describe : describe.skip)("a business's sender address", () => {
  let t: TwoTenants;
  let a: ReturnType<typeof session>;
  let b: ReturnType<typeof session>;
  let sales: ReturnType<typeof session>;

  beforeAll(async () => {
    process.env.RESEND_API_KEY = "re_test_unused";
    t = await createTwoTenants();
    holder.db = createTenantDb(t.appDb);
    holder.platform = t.db;
    a = session(t.a.tenantId, t.a.admin, "ADMIN");
    b = session(t.b.tenantId, t.b.admin, "ADMIN");
    sales = session(t.a.tenantId, t.a.sales, "SALES");
  }, 60_000);
  afterAll(async () => {
    holder.user = null;
    delete process.env.RESEND_API_KEY;
    await t?.dispose();
  });
  beforeEach(() => {
    provider.rejects = false;
  });
  const put = (as: typeof a, body: object) => call(senderRoute.PUT as Handler, as, { method: "PUT", body });
  const from = (tenantId: string, name = "Shop") => withTenant(tenantId, () => senderFor(tenantId, name));

  it("is for admins only, and starts on the shared address", async () => {
    expect((await call(senderRoute.GET as Handler, sales)).status).toBe(403);
    expect((await put(sales, { domain: "shop.test", localPart: "hello" })).status).toBe(403);
    const view = (await call(senderRoute.GET as Handler, a)).json!.data!;
    expect(view).toMatchObject({ available: true, status: "none", domain: null });
    expect(await from(t.a.tenantId)).toBe('"Shop" <noreply@platform.test>');
  });

  it("is not used until the domain is verified, then it is, and a changed domain starts over", async () => {
    const saved = await put(a, { domain: "Mail.Shop.test", localPart: "Hello" });
    expect(saved.status).toBe(200);
    expect(saved.json!.data).toMatchObject({ status: "pending", address: "hello@mail.shop.test" });
    // Only the records a sender needs are shown.
    expect((saved.json!.data!.records as { record: string }[]).map((r) => r.record)).toEqual(["SPF", "DKIM"]);
    expect(await from(t.a.tenantId)).toBe('"Shop" <noreply@platform.test>');

    // DNS not published yet: still pending.
    expect((await call(verifyRoute.POST as Handler, a, { method: "POST" })).json!.data).toMatchObject({ status: "pending" });
    expect(await from(t.a.tenantId)).toBe('"Shop" <noreply@platform.test>');

    for (const d of provider.domains.values()) if (d.name === "mail.shop.test") d.verified = true;
    expect((await call(verifyRoute.POST as Handler, a, { method: "POST" })).json!.data).toMatchObject({ status: "verified" });
    expect(await from(t.a.tenantId, 'Ada "the boss"\r\nBcc: x')).toBe('"Ada the bossBcc: x" <hello@mail.shop.test>');

    // Another local part on the same verified domain keeps the verification.
    await put(a, { domain: "mail.shop.test", localPart: "orders" });
    expect(await from(t.a.tenantId)).toBe('"Shop" <orders@mail.shop.test>');

    // A different domain must be verified again, and the old one is dropped from the provider.
    const before = provider.domains.size;
    await put(a, { domain: "other.shop.test", localPart: "orders" });
    expect(await from(t.a.tenantId)).toBe('"Shop" <noreply@platform.test>');
    expect(provider.domains.size).toBe(before); // one added, one removed
    expect([...provider.domains.values()].map((d) => d.name)).not.toContain("mail.shop.test");
  });

  it("can't take a domain another business has, and doesn't leave a stray domain at the provider", async () => {
    const before = provider.domains.size;
    const taken = await put(b, { domain: "other.shop.test", localPart: "hi" });
    expect(taken.status).toBe(409);
    expect(taken.json).toMatchObject({ code: "DOMAIN_TAKEN" });
    expect(provider.domains.size).toBe(before);
    expect((await call(senderRoute.GET as Handler, b)).json!.data).toMatchObject({ status: "none", domain: null });
  });

  it("shows the provider's refusal, never marks a domain verified on its own say-so, and keeps one business out of another's setting", async () => {
    provider.rejects = true;
    const refused = await put(b, { domain: "refused.test", localPart: "hi" });
    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({ code: "DOMAIN_REJECTED" });
    // The app role can't write the verified state itself.
    if (t.rls) await expect(withTenant(t.b.tenantId, () => (holder.db as { tenant: { update(a: object): Promise<unknown> } }).tenant.update({ where: { id: t.b.tenantId }, data: { senderVerifiedAt: new Date() } }))).rejects.toThrow();
    // A's address never shows up for B.
    expect(await from(t.b.tenantId)).toBe('"Shop" <noreply@platform.test>');
  });

  it("goes back to the shared address when removed", async () => {
    const res = await call(senderRoute.DELETE as Handler, a, { method: "DELETE" });
    expect(res.json!.data).toMatchObject({ status: "none", domain: null });
    expect(await from(t.a.tenantId)).toBe('"Shop" <noreply@platform.test>');
    expect(provider.domains.size).toBe(0);
  });
});
