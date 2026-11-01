import Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTenantDb } from "@/lib/tenant-db";
import { createTwoTenants, testDatabaseUrl, type TwoTenants } from "./helpers/two-tenants";

// Phase 4 of MULTI_TENANCY_PLAN.md on a real database with two businesses: signing up and confirming, the trial, a
// subscription's events, read-only mode, plan limits, and the business's own details. Stripe itself is never called:
// events are signed with a made-up secret and the two Stripe calls checkout makes are stubbed. Not run against real
// Stripe test mode.

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
// The route is called outside a request, where Next's `after` has no scope: run the work now, and keep the promise so
// the test can wait for it (the sign-up work hashes a password, so it finishes after the response has been returned).
const afterWork = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void afterWork.push(Promise.resolve().then(fn)) }));

import * as adminTenant from "@/app/api/admin/tenant/route";
import * as adminUsers from "@/app/api/admin/users/route";
import * as billing from "@/app/api/billing/route";
import * as checkout from "@/app/api/billing/checkout/route";
import * as contacts from "@/app/api/contacts/route";
import * as signup from "@/app/api/signup/route";
import * as verify from "@/app/api/signup/verify/route";
import * as billingHook from "@/app/api/webhooks/billing/route";
import { billingStripe } from "@/lib/billing";
import { purgeUnconfirmedSignups } from "@/lib/signup";

const run = testDatabaseUrl() ? describe : describe.skip;

type Handler = (req: Request, ctx: { params: Promise<never> }) => Promise<Response>;
const session = (tenantId: string, id: string, role: "ADMIN" | "SALES", tenantWritable = true) => ({ id, tenantId, role, tenantWritable, name: id, email: `${id}@x.test` });

async function call(handler: Handler, as: ReturnType<typeof session> | null, opts: { method?: string; body?: unknown; url?: string } = {}) {
  holder.user = as;
  const res = await handler(
    new Request(opts.url ?? "http://x.test/api/x", { method: opts.method ?? "GET", headers: { "Content-Type": "application/json" }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }),
    { params: Promise.resolve({} as never) },
  );
  const text = await res.text();
  let json: Record<string, unknown> | undefined;
  try {
    json = JSON.parse(text);
  } catch {
    // empty body
  }
  return { status: res.status, json, text };
}

run("sign-up, trial and billing", () => {
  let t: TwoTenants;
  let a: ReturnType<typeof session>;
  let b: ReturnType<typeof session>;
  const WHSEC = "whsec_billing_test_secret";

  beforeAll(async () => {
    process.env.NEXTAUTH_SECRET ||= "test-secret-test-secret-0123456789ab";
    process.env.BILLING_STRIPE_SECRET_KEY = "sk_test_billing_unused";
    process.env.BILLING_STRIPE_WEBHOOK_SECRET = WHSEC;
    process.env.BILLING_PRICE_STARTER = "price_starter_1";
    process.env.BILLING_PRICE_PRO = "price_pro_1";
    t = await createTwoTenants();
    holder.db = createTenantDb(t.appDb);
    holder.platform = t.db;
    a = session(t.a.tenantId, t.a.admin, "ADMIN");
    b = session(t.b.tenantId, t.b.admin, "ADMIN");
  }, 60_000);
  afterAll(async () => {
    holder.user = null;
    delete process.env.SIGNUP_ENABLED;
    await t?.dispose();
  });
  beforeEach(() => {
    mail.length = 0;
  });

  // ── Signing up ──────────────────────────────────────────────────────────────────────────────────────────────
  describe("sign-up", () => {
    const body = { businessName: "Fresh Hair Co", name: "Nia Okoro", email: "nia@fresh.test", password: "Sup3r-secret-pw" };
    const post = async (b2: unknown = body) => {
      const res = await call(signup.POST as Handler, null, { method: "POST", body: b2 });
      await Promise.all(afterWork.splice(0));
      return res;
    };
    const tokenFromMail = () => new URL(mail.find((m) => /verify-email/.test(m.text))!.text.match(/https:\/\/\S+/)![0]).searchParams.get("token")!;

    it("is closed unless the owner switches it on", async () => {
      delete process.env.SIGNUP_ENABLED;
      expect((await post()).status).toBe(404);
      expect(await t.db.user.count({ where: { email: body.email } })).toBe(0);
    });

    it("creates a pending business on a trial, whose admin can't sign in until the emailed link is used", async () => {
      process.env.SIGNUP_ENABLED = "1";
      expect((await post()).status).toBe(200);
      const user = await t.db.user.findUniqueOrThrow({ where: { email: body.email }, include: { tenant: true } });
      expect(user).toMatchObject({ role: "ADMIN", isActive: true, emailVerified: null });
      expect(user.passwordHash).toBeTruthy();
      expect(user.passwordHash).not.toContain("Sup3r");
      expect(user.tenant).toMatchObject({ status: "PENDING", plan: "trial", billingStatus: "TRIALING", name: "Fresh Hair Co" });
      expect(user.tenant.trialEndsAt!.getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);
      expect(mail.map((m) => m.to)).toEqual([body.email]);

      // Confirming turns it on, once.
      const token = tokenFromMail();
      expect((await call(verify.POST as Handler, null, { method: "POST", body: { token } })).status).toBe(200);
      expect(await t.db.tenant.findUniqueOrThrow({ where: { id: user.tenantId } })).toMatchObject({ status: "ACTIVE" });
      expect((await t.db.user.findUniqueOrThrow({ where: { email: body.email } })).emailVerified).toBeTruthy();
      expect((await call(verify.POST as Handler, null, { method: "POST", body: { token } })).status).toBe(400);
      expect((await t.db.auditLog.findMany({ where: { tenantId: user.tenantId } })).map((r) => r.action).sort()).toEqual(["signup.created", "signup.verified"]);
    });

    it("answers the same for an email that already has an account, creates nothing and warns the owner of the address", async () => {
      const before = await t.db.tenant.count();
      const again = await post();
      expect(again.status).toBe(200);
      expect(await t.db.tenant.count()).toBe(before);
      expect(mail).toHaveLength(1);
      expect(mail[0].subject).toMatch(/already have/i);
    });

    it("checks what it is given and is rate limited", async () => {
      expect((await post({ ...body, email: "weak@fresh.test", password: "short" })).status).toBe(422);
      expect((await post({ ...body, email: "not-an-email" })).status).toBe(422);
      let last = 200;
      for (let i = 0; i < 6; i++) last = (await post({ ...body, email: `spam${i}@fresh.test` })).status;
      expect(last).toBe(429);
    });

    it("a password-reset link can't confirm a signup", async () => {
      const { createPasswordResetToken } = await import("@/lib/tokens");
      const raw = await createPasswordResetToken("someone@x.test");
      expect((await call(verify.POST as Handler, null, { method: "POST", body: { token: raw } })).status).toBe(400);
    });

    it("deletes signups nobody confirmed after a week, and nothing else", async () => {
      const stale = await t.db.tenant.create({ data: { name: "Ghost", slug: "ghost-1", status: "PENDING", createdAt: new Date(Date.now() - 8 * 86_400_000), users: { create: { email: "ghost@x.test", name: "G", role: "ADMIN" } } } });
      const fresh = await t.db.tenant.create({ data: { name: "Recent", slug: "recent-1", status: "PENDING", users: { create: { email: "recent@x.test", name: "R", role: "ADMIN" } } } });
      expect(await purgeUnconfirmedSignups()).toBe(1);
      expect(await t.db.tenant.findUnique({ where: { id: stale.id } })).toBeNull();
      expect(await t.db.user.count({ where: { email: "ghost@x.test" } })).toBe(0);
      expect(await t.db.tenant.findUnique({ where: { id: fresh.id } })).not.toBeNull();
      expect(await t.db.tenant.count({ where: { id: { in: [t.a.tenantId, t.b.tenantId] } } })).toBe(2);
    });
  });

  // ── A subscription's events ─────────────────────────────────────────────────────────────────────────────────
  describe("subscription events", () => {
    const stripeLib = new Stripe("sk_test_unused");
    let seq = 1000;
    const send = (type: string, sub: Record<string, unknown>, created = ++seq) => {
      const payload = JSON.stringify({ id: `evt_${created}`, object: "event", type, created, data: { object: { object: "subscription", id: "sub_1", ...sub } } });
      return (billingHook.POST as Handler)(new Request("http://x.test/api/webhooks/billing", { method: "POST", headers: { "stripe-signature": stripeLib.webhooks.generateTestHeaderString({ payload, secret: WHSEC }) }, body: payload }), { params: Promise.resolve({} as never) });
    };
    const item = (price: string, end: number) => ({ items: { data: [{ price: { id: price }, current_period_end: end }] } });
    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86_400;
    const row = () => t.db.tenant.findUniqueOrThrow({ where: { id: t.a.tenantId } });

    beforeAll(async () => {
      await t.db.tenant.update({ where: { id: t.a.tenantId }, data: { plan: "trial", billingStatus: "TRIALING", trialEndsAt: new Date(Date.now() + 5 * 86_400_000), stripeCustomerId: "cus_A" } });
    });

    it("rejects an unsigned or wrongly signed event", async () => {
      const payload = "{}";
      const bad = await (billingHook.POST as Handler)(new Request("http://x.test", { method: "POST", headers: { "stripe-signature": stripeLib.webhooks.generateTestHeaderString({ payload, secret: "whsec_wrong" }) }, body: payload }), { params: Promise.resolve({} as never) });
      expect(bad.status).toBe(400);
      const none = await (billingHook.POST as Handler)(new Request("http://x.test", { method: "POST", body: payload }), { params: Promise.resolve({} as never) });
      expect(none.status).toBe(400);
    });

    it("moves the business onto the plan it bought, and records the period it paid for", async () => {
      expect(await (await send("customer.subscription.created", { customer: "cus_A", status: "active", ...item("price_pro_1", periodEnd) })).json()).toMatchObject({ outcome: "applied" });
      expect(await row()).toMatchObject({ plan: "pro", billingStatus: "ACTIVE", stripeSubscriptionId: "sub_1" });
      expect((await row()).currentPeriodEnd!.getTime()).toBe(periodEnd * 1000);
      expect((await t.db.auditLog.findFirst({ where: { tenantId: t.a.tenantId, action: "billing.subscription_updated" } }))?.entityId).toBe(t.a.tenantId);
    });

    it("ignores an event that arrives late, so an old state can't undo a newer one", async () => {
      await send("customer.subscription.updated", { customer: "cus_A", status: "past_due", ...item("price_pro_1", periodEnd) }, 5000);
      expect((await row()).billingStatus).toBe("PAST_DUE");
      const late = await send("customer.subscription.updated", { customer: "cus_A", status: "active", ...item("price_starter_1", periodEnd) }, 4000);
      expect(await late.json()).toMatchObject({ outcome: "stale" });
      expect(await row()).toMatchObject({ billingStatus: "PAST_DUE", plan: "pro" });
    });

    it("finds the business by the Stripe customer we stored, never by anything the event claims", async () => {
      // An event for another business's customer id can't touch A, even if its metadata names A.
      const r = await send("customer.subscription.updated", { customer: "cus_unknown", status: "canceled", metadata: { tenantId: t.a.tenantId }, ...item("price_pro_1", periodEnd) }, 6000);
      expect(await r.json()).toMatchObject({ outcome: "unknown_customer" });
      expect((await row()).billingStatus).toBe("PAST_DUE");
      expect((await t.db.tenant.findUniqueOrThrow({ where: { id: t.b.tenantId } })).billingStatus).toBe("ACTIVE");
    });

    it("cancels at the end, keeping access until the paid period is over", async () => {
      await send("customer.subscription.deleted", { customer: "cus_A", status: "canceled", ...item("price_pro_1", periodEnd) }, 7000);
      expect(await row()).toMatchObject({ billingStatus: "CANCELED" });
      const view = await call(billing.GET as Handler, a);
      expect(view.json).toMatchObject({ data: { status: "CANCELED", writable: true } }); // period not over yet
      await t.db.tenant.update({ where: { id: t.a.tenantId }, data: { currentPeriodEnd: new Date(Date.now() - 1000) } });
      expect((await call(billing.GET as Handler, a)).json).toMatchObject({ data: { writable: false, readOnlyReason: "canceled" } });
    });
  });

  // ── Read-only mode and plan limits ─────────────────────────────────────────────────────────────────────────
  describe("when a business can't pay or has outgrown its plan", () => {
    it("goes read-only: reads and exports work, changes are refused, paying stays open", async () => {
      const locked = session(t.a.tenantId, t.a.admin, "ADMIN", false);
      const write = await call(contacts.POST as Handler, locked, { method: "POST", body: { firstName: "No", lastName: "Way" }, url: "http://x.test/api/contacts" });
      expect(write.status).toBe(403);
      expect(write.json).toMatchObject({ code: "READ_ONLY" });
      expect(await t.db.contact.count({ where: { lastName: "Way" } })).toBe(0);
      expect((await call(contacts.GET as Handler, locked, { url: "http://x.test/api/contacts" })).status).toBe(200);
      // Paying is allowed (Stripe is stubbed; the point is that it isn't refused as read-only).
      const stripe = billingStripe();
      vi.spyOn(stripe.customers, "create").mockResolvedValue({ id: "cus_new" } as never);
      vi.spyOn(stripe.checkout.sessions, "create").mockResolvedValue({ url: "https://checkout.stripe.test/s" } as never);
      await t.db.tenant.update({ where: { id: t.b.tenantId }, data: { plan: "trial", billingStatus: "TRIALING", trialEndsAt: new Date(Date.now() - 1000) } });
      const lockedB = session(t.b.tenantId, t.b.admin, "ADMIN", false);
      const pay = await call(checkout.POST as Handler, lockedB, { method: "POST", body: { plan: "starter" }, url: "http://x.test/api/billing/checkout" });
      expect(pay.status, pay.text).toBe(200);
      expect(pay.json).toMatchObject({ data: { url: "https://checkout.stripe.test/s" } });
      // The customer is recorded against B, and the subscription carries B's id for tracing.
      expect((await t.db.tenant.findUniqueOrThrow({ where: { id: t.b.tenantId } })).stripeCustomerId).toBe("cus_new");
      expect(vi.mocked(stripe.checkout.sessions.create).mock.calls[0][0]).toMatchObject({ customer: "cus_new", client_reference_id: t.b.tenantId, line_items: [{ price: "price_starter_1", quantity: 1 }] });
    });

    it("stops a business adding users beyond its plan", async () => {
      await t.db.tenant.update({ where: { id: t.a.tenantId }, data: { plan: "starter", billingStatus: "ACTIVE" } }); // 3 users allowed; A has 2
      const add = (n: number) => call(adminUsers.POST as Handler, a, { method: "POST", body: { name: `New ${n}`, email: `new${n}@a.test`, role: "SALES" }, url: "http://x.test/api/admin/users" });
      expect((await add(1)).status).toBe(201);
      const over = await add(2);
      expect(over.status).toBe(403);
      expect(over.json).toMatchObject({ code: "PLAN_LIMIT" });
      expect(await t.db.user.count({ where: { email: "new2@a.test" } })).toBe(0);
      // B has the same plan size but its own count, so it is not affected by A's users.
      await t.db.tenant.update({ where: { id: t.b.tenantId }, data: { plan: "starter", billingStatus: "ACTIVE" } });
      expect((await call(adminUsers.POST as Handler, b, { method: "POST", body: { name: "B new", email: "bnew@b.test", role: "SALES" }, url: "http://x.test/api/admin/users" })).status).toBe(201);
    });

    it("reports plan, usage and limits on the billing screen", async () => {
      const v = await call(billing.GET as Handler, a);
      expect(v.json).toMatchObject({ data: { plan: "starter", limits: { users: 3, contacts: 1000 }, usage: { users: 3 } } });
      expect((v.json as { data: { plans: unknown[] } }).data.plans).toHaveLength(2);
    });
  });

  // ── The business's own details ─────────────────────────────────────────────────────────────────────────────
  describe("business details", () => {
    it("lets an admin change how the business presents itself, and only their own business", async () => {
      const r = await call(adminTenant.PATCH as Handler, a, { method: "PATCH", body: { brandName: "A Brand", senderName: "A Team" } });
      expect(r.status, r.text).toBe(200);
      expect(await t.db.tenant.findUniqueOrThrow({ where: { id: t.a.tenantId } })).toMatchObject({ brandName: "A Brand", senderName: "A Team" });
      expect((await t.db.tenant.findUniqueOrThrow({ where: { id: t.b.tenantId } })).brandName).toBeNull();
    });

    it("can't be used to change billing, and refuses odd characters", async () => {
      await call(adminTenant.PATCH as Handler, a, { method: "PATCH", body: { plan: "pro", billingStatus: "ACTIVE", status: "SUSPENDED" } });
      expect(await t.db.tenant.findUniqueOrThrow({ where: { id: t.a.tenantId } })).toMatchObject({ plan: "starter", status: "ACTIVE" });
      expect((await call(adminTenant.PATCH as Handler, a, { method: "PATCH", body: { brandName: "Evil\r\nBcc: x@y.z" } })).status).toBe(422);
    });
  });
});
