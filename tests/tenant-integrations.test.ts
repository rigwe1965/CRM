import { createHmac } from "node:crypto";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTenantDb } from "@/lib/tenant-db";
import { createTwoTenants, testDatabaseUrl, type TwoTenants } from "./helpers/two-tenants";

// Phase 3 of MULTI_TENANCY_PLAN.md, the check that matters: a payment or message for business A can never be recorded
// against business B, and each business's settings stay its own. Real handlers on a real database with two
// businesses (see tenant-routes.test.ts for the setup); only the session and outgoing mail are faked.

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

import * as integrationKind from "@/app/api/admin/integrations/[kind]/route";
import * as integrations from "@/app/api/admin/integrations/route";
import * as leadForTenant from "@/app/api/public/lead/[tenant]/route";
import * as stripeForTenant from "@/app/api/webhooks/stripe/[tenant]/route";
import * as whatsappForTenant from "@/app/api/webhooks/whatsapp/[tenant]/route";

const run = testDatabaseUrl() ? describe : describe.skip;

type Handler = (req: Request, ctx: { params: Promise<never> }) => Promise<Response>;
const session = (tenantId: string, id: string, role: "ADMIN" | "SALES") => ({ id, tenantId, role, name: id, email: `${id}@x.test` });

async function call(handler: Handler, as: ReturnType<typeof session>, opts: { method?: string; body?: unknown; params?: Record<string, string> } = {}) {
  holder.user = as;
  const res = await handler(
    new Request("http://x.test/api/admin/integrations", {
      method: opts.method ?? "GET",
      headers: { "Content-Type": "application/json" },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
    { params: Promise.resolve((opts.params ?? {}) as never) },
  );
  const text = await res.text();
  let json: Record<string, never> | undefined;
  try {
    json = JSON.parse(text);
  } catch {
    // empty bodies
  }
  return { status: res.status, json, text };
}

run("per-business integrations", () => {
  let t: TwoTenants;
  let a: ReturnType<typeof session>;
  let b: ReturnType<typeof session>;
  let aSales: ReturnType<typeof session>;

  const A_STRIPE = { secretKey: "sk_test_AAAAAAAAAA", webhookSecret: "whsec_AAAAAAAAAA" };
  const B_STRIPE = { secretKey: "sk_test_BBBBBBBBBB", webhookSecret: "whsec_BBBBBBBBBB" };
  const A_WA = { accessToken: "a-access-token-123", phoneNumberId: "111111111", appSecret: "a-app-secret-123456", verifyToken: "a-verify-token-123456" };

  const put = (as: ReturnType<typeof session>, kind: string, body: unknown) => call(integrationKind.PUT as Handler, as, { method: "PUT", body, params: { kind } });

  beforeAll(async () => {
    process.env.NEXTAUTH_SECRET ||= "test-secret-test-secret-0123456789ab";
    for (const k of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "LEAD_FORM_ORIGINS"]) delete process.env[k];
    t = await createTwoTenants();
    holder.db = createTenantDb(t.appDb);
    holder.platform = t.db;
    a = session(t.a.tenantId, t.a.admin, "ADMIN");
    b = session(t.b.tenantId, t.b.admin, "ADMIN");
    aSales = session(t.a.tenantId, t.a.sales, "SALES");
  }, 60_000);
  afterAll(async () => {
    holder.user = null;
    await t?.dispose();
  });

  it("saves a business's settings encrypted and never sends a secret back", async () => {
    const saved = await put(a, "stripe", A_STRIPE);
    expect(saved.status, saved.text).toBe(200);
    expect(saved.text).not.toContain("sk_test_AAAA");
    expect(saved.text).not.toContain("whsec_AAAA");
    const row = await t.db.tenantIntegration.findFirstOrThrow({ where: { tenantId: t.a.tenantId, kind: "STRIPE" } });
    expect(row.config).not.toContain("sk_test");
    expect(row.config).not.toContain(t.a.tenantId);

    const mine = await call(integrations.GET as Handler, a);
    expect(mine.json).toMatchObject({ data: { stripe: { configured: true, source: "settings" } } });
    expect(mine.text).not.toContain("sk_test");
    expect(mine.text).toContain(`/api/webhooks/stripe/${t.a.tenantId}`);
  });

  it("keeps one business's settings out of another's view, and out of its reach", async () => {
    const theirs = await call(integrations.GET as Handler, b);
    expect(theirs.json).toMatchObject({ data: { stripe: { configured: false }, whatsapp: { configured: false } } });
    expect(await t.db.tenantIntegration.count({ where: { tenantId: t.b.tenantId, kind: "STRIPE" } })).toBe(0);
    // Removing A's settings from B's session removes nothing of A's.
    expect((await call(integrationKind.DELETE as Handler, b, { method: "DELETE", params: { kind: "stripe" } })).status).toBe(204);
    expect(await t.db.tenantIntegration.count({ where: { tenantId: t.a.tenantId, kind: "STRIPE" } })).toBe(1);
  });

  it("is for a business's admin only, and checks what it is given", async () => {
    expect((await put(aSales, "stripe", A_STRIPE)).status).toBe(403);
    expect((await call(integrations.GET as Handler, aSales)).status).toBe(403);
    expect((await put(a, "stripe", { secretKey: "not-a-key", webhookSecret: "whsec_AAAAAAAAAA" })).status).toBe(422);
    expect((await put(a, "whatsapp", { ...A_WA, verifyToken: "short" })).status).toBe(422);
    expect((await put(a, "lead-form", { origins: ["https://shop.test/some/path"] })).status).toBe(422);
    expect((await put(a, "nonsense", {})).status).toBe(404);
  });

  it("refuses settings copied from another business's row", async () => {
    await put(b, "stripe", B_STRIPE);
    const aRow = await t.db.tenantIntegration.findFirstOrThrow({ where: { tenantId: t.a.tenantId, kind: "STRIPE" } });
    const bRow = await t.db.tenantIntegration.findFirstOrThrow({ where: { tenantId: t.b.tenantId, kind: "STRIPE" } });
    await t.db.tenantIntegration.update({ where: { id: bRow.id }, data: { config: aRow.config } });
    const view = await call(integrations.GET as Handler, b);
    expect(view.json).toMatchObject({ data: { stripe: { configured: false } } });
    await put(b, "stripe", B_STRIPE); // put it right again for the tests below
  });

  describe("Stripe", () => {
    const stripeLib = new Stripe("sk_test_unused");
    const event = (linkId: string) =>
      JSON.stringify({
        id: "evt_1",
        object: "event",
        type: "checkout.session.completed",
        data: { object: { id: "cs_1", object: "checkout.session", payment_status: "paid", payment_link: linkId, payment_intent: "pi_cross", amount_total: 5000, currency: "usd" } },
      });
    const send = (tenantId: string, payload: string, secret: string) =>
      (stripeForTenant.POST as Handler)(
        new Request(`http://x.test/api/webhooks/stripe/${tenantId}`, { method: "POST", headers: { "stripe-signature": stripeLib.webhooks.generateTestHeaderString({ payload, secret }) }, body: payload }),
        { params: Promise.resolve({ tenant: tenantId } as never) },
      );

    it("never credits a payment link of one business through another business's webhook", async () => {
      await t.db.paymentLink.updateMany({ where: { tenantId: t.a.tenantId }, data: { providerLinkId: "plink_of_a" } });
      const before = await t.db.payment.count({ where: { dealId: t.a.deal } });

      // B signs a perfectly valid event with its own secret, naming A's payment link.
      const viaB = await send(t.b.tenantId, event("plink_of_a"), B_STRIPE.webhookSecret);
      expect(await viaB.json()).toMatchObject({ outcome: "unknown_link" });
      // An event signed with A's secret does not pass on B's address either.
      expect((await send(t.b.tenantId, event("plink_of_a"), A_STRIPE.webhookSecret)).status).toBe(400);
      expect(await t.db.payment.count({ where: { dealId: t.a.deal } })).toBe(before);
      expect(await t.db.payment.count({ where: { dealId: t.b.deal } })).toBe(1);

      // On its own address, with its own secret, A's payment is recorded in A.
      const viaA = await send(t.a.tenantId, event("plink_of_a"), A_STRIPE.webhookSecret);
      expect(await viaA.json()).toMatchObject({ outcome: "recorded" });
      expect(await t.db.payment.count({ where: { dealId: t.a.deal } })).toBe(before + 1);
      expect((await t.db.payment.findFirstOrThrow({ where: { providerRef: "pi_cross" } })).tenantId).toBe(t.a.tenantId);
    });

    it("answers a business that has no Stripe settings the same as an unknown one", async () => {
      await call(integrationKind.DELETE as Handler, b, { method: "DELETE", params: { kind: "stripe" } });
      expect((await send(t.b.tenantId, event("plink_of_a"), B_STRIPE.webhookSecret)).status).toBe(400);
      expect((await send("no_such_business", event("plink_of_a"), B_STRIPE.webhookSecret)).status).toBe(400);
    });
  });

  describe("WhatsApp", () => {
    const body = JSON.stringify({
      entry: [{ changes: [{ value: { contacts: [{ wa_id: "4915906462275", profile: { name: "Ada" } }], messages: [{ id: "wamid.cross", from: "4915906462275", timestamp: "1790000000", type: "text", text: { body: "Hi" } }] } }] }],
    });
    const sign = (secret: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    const post = (tenantId: string, secret: string) =>
      (whatsappForTenant.POST as Handler)(new Request(`http://x.test/api/webhooks/whatsapp/${tenantId}`, { method: "POST", headers: { "x-hub-signature-256": sign(secret) }, body }), {
        params: Promise.resolve({ tenant: tenantId } as never),
      });

    it("files a message under the business whose webhook and secret received it, and only that one", async () => {
      expect((await put(a, "whatsapp", A_WA)).status).toBe(200);

      expect((await post(t.b.tenantId, A_WA.appSecret)).status).toBe(401); // B has no WhatsApp settings
      expect(await t.db.activity.count({ where: { externalId: "wamid.cross" } })).toBe(0);

      await put(b, "whatsapp", { ...A_WA, phoneNumberId: "222222222", appSecret: "b-app-secret-123456", verifyToken: "b-verify-token-123456" });
      expect((await post(t.b.tenantId, A_WA.appSecret)).status).toBe(401); // A's secret doesn't open B's webhook
      expect(await t.db.activity.count({ where: { externalId: "wamid.cross" } })).toBe(0);

      expect((await post(t.a.tenantId, A_WA.appSecret)).status).toBe(200);
      const filed = await t.db.activity.findMany({ where: { externalId: "wamid.cross" } });
      expect(filed.map((x) => x.tenantId)).toEqual([t.a.tenantId]);
    });

    it("answers Meta's set-up check with the business's own verify token", async () => {
      const check = (tenantId: string, token: string) =>
        (whatsappForTenant.GET as Handler)(new Request(`http://x.test/api/webhooks/whatsapp/${tenantId}?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=777`), {
          params: Promise.resolve({ tenant: tenantId } as never),
        });
      expect((await check(t.a.tenantId, A_WA.verifyToken)).status).toBe(200);
      expect((await check(t.b.tenantId, A_WA.verifyToken)).status).toBe(403);
    });
  });

  describe("website form", () => {
    const lead = (tenantId: string, origin?: string) =>
      (leadForTenant.POST as Handler)(
        new Request(`http://x.test/api/public/lead/${tenantId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
          body: JSON.stringify({ name: "Web Visitor", email: "visitor@web.test", message: "hello", website: "" }),
        }),
        { params: Promise.resolve({ tenant: tenantId } as never) },
      );

    it("takes enquiries only from the business's own listed websites, into that business", async () => {
      expect((await put(a, "lead-form", { origins: ["https://shop-a.test"] })).status).toBe(200);

      expect((await lead(t.b.tenantId, "https://shop-a.test")).status).toBe(403); // B listed no websites
      expect((await lead(t.a.tenantId, "https://elsewhere.test")).status).toBe(403);
      expect(await t.db.contact.count({ where: { email: "visitor@web.test" } })).toBe(0);

      expect((await lead(t.a.tenantId, "https://shop-a.test")).status).toBe(200);
      const made = await t.db.contact.findMany({ where: { email: "visitor@web.test" } });
      expect(made.map((c) => c.tenantId)).toEqual([t.a.tenantId]);
    });

    it("says not found for a business that doesn't exist or is suspended", async () => {
      expect((await lead("no_such_business")).status).toBe(404);
      await t.db.tenant.update({ where: { id: t.b.tenantId }, data: { status: "SUSPENDED" } });
      expect((await lead(t.b.tenantId)).status).toBe(404);
      await t.db.tenant.update({ where: { id: t.b.tenantId }, data: { status: "ACTIVE" } });
    });
  });
});
