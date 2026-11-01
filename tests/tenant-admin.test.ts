import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTwoTenants, testDatabaseUrl, type TwoTenants } from "./helpers/two-tenants";
import { billingFor, createBusiness, isPlanChoice, setPlan } from "../scripts/tenant-admin-lib";
import { accessOf, PLANS } from "@/lib/plans";

// The platform owner's `create` and `set-plan` commands. The pure parts always run; the rest needs TEST_DATABASE_URL
// (CI sets it) and builds its own throwaway schema.

const { holder } = vi.hoisted(() => ({ holder: { platform: null as unknown } }));
vi.mock("@/lib/platform-db", () => ({
  platformDb: new Proxy({}, { get: (_t, key) => { const target = holder.platform as Record<string | symbol, unknown>; const v = target[key]; return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v; } }),
}));
import { consumePasswordResetToken } from "@/lib/tokens";

const now = new Date("2026-11-01T00:00:00Z");

describe("billing for a hand-made plan", () => {
  it("never leaves the plan unset (the column default is the unlimited internal plan)", () => {
    for (const p of ["trial", "starter", "pro"] as const) expect(billingFor(p, now).plan).toBe(p);
    expect(isPlanChoice("internal")).toBe(false);
    expect(isPlanChoice("enterprise")).toBe(false);
  });
  it("makes a trial time-limited and a paid plan simply active", () => {
    expect(billingFor("trial", now, 30)).toMatchObject({ billingStatus: "TRIALING", trialEndsAt: new Date("2026-12-01T00:00:00Z") });
    expect(billingFor("starter", now)).toMatchObject({ billingStatus: "ACTIVE", trialEndsAt: null });
  });
  it("gives a writable workspace in both cases, and the plan's own limits", () => {
    for (const p of ["trial", "starter", "pro"] as const) {
      const access = accessOf({ status: "ACTIVE", ...billingFor(p, now), currentPeriodEnd: null }, now);
      expect(access.writable).toBe(true);
      expect(access.limits).toEqual(PLANS[p].limits);
    }
  });
});

const run = testDatabaseUrl() ? describe : describe.skip;

run("create and set-plan on a real database", () => {
  let t: TwoTenants;
  let db: PrismaClient;
  beforeAll(async () => {
    t = await createTwoTenants();
    db = t.db as PrismaClient;
    holder.platform = t.db;
  }, 180_000);
  afterAll(async () => {
    await t?.dispose();
  }, 60_000);

  it("creates an active business on the chosen plan with an admin who has no password yet", async () => {
    const made = await createBusiness(db, { name: "Pilot Hair Shop", adminEmail: "Owner@Pilot.Test", adminName: "Ola Owner", plan: "starter" }, now);
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: made.tenant.id }, include: { users: true } });
    expect(tenant).toMatchObject({ name: "Pilot Hair Shop", brandName: "Pilot Hair Shop", status: "ACTIVE", plan: "starter", billingStatus: "ACTIVE" });
    expect(tenant.slug).toMatch(/^pilot-hair-shop-[0-9a-f]{6}$/);
    expect(tenant.users).toHaveLength(1);
    expect(tenant.users[0]).toMatchObject({ email: "owner@pilot.test", name: "Ola Owner", role: "ADMIN", isActive: true, passwordHash: null, mfaEnabledAt: null });
    expect(await db.auditLog.count({ where: { tenantId: tenant.id, action: "tenant.created_by_operator" } })).toBe(1);
  });

  it("prints an invite that the app's own reset page accepts, once", async () => {
    const made = await createBusiness(db, { name: "Second Shop", adminEmail: "boss@second.test", plan: "trial", trialDays: 30 }, now);
    expect(await consumePasswordResetToken(made.token)).toBe("boss@second.test");
    expect(await consumePasswordResetToken(made.token)).toBeNull();
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: made.tenant.id } });
    expect(tenant).toMatchObject({ plan: "trial", billingStatus: "TRIALING", trialEndsAt: new Date("2026-12-01T00:00:00Z") });
  });

  it("refuses a bad name, a bad email, a bad plan and an email that already has an account", async () => {
    await expect(createBusiness(db, { name: "x", adminEmail: "a@b.test", plan: "trial" })).rejects.toThrow(/name/);
    await expect(createBusiness(db, { name: "Fine Name", adminEmail: "not-an-email", plan: "trial" })).rejects.toThrow(/email/);
    await expect(createBusiness(db, { name: "Fine Name", adminEmail: "a@b.test", plan: "internal" as never })).rejects.toThrow(/plan/);
    await expect(createBusiness(db, { name: "Fine Name", adminEmail: "a@b.test", plan: "trial", trialDays: 0 })).rejects.toThrow(/trial-days/);
    await expect(createBusiness(db, { name: "Dup Shop", adminEmail: `admin-a@x.test`, plan: "trial" })).rejects.toThrow(/already has an account/);
    expect(await db.tenant.count({ where: { name: "Dup Shop" } })).toBe(0);
  });

  it("moves a business between plans and writes an audit entry", async () => {
    const made = await createBusiness(db, { name: "Plan Shop", adminEmail: "p@plan.test", plan: "trial" }, now);
    const changed = await setPlan(db, made.tenant.id, "pro", {}, now);
    expect(changed).toMatchObject({ from: "trial", to: "pro" });
    expect(await db.tenant.findUniqueOrThrow({ where: { id: made.tenant.id } })).toMatchObject({ plan: "pro", billingStatus: "ACTIVE", trialEndsAt: null });
    const log = await db.auditLog.findFirstOrThrow({ where: { tenantId: made.tenant.id, action: "tenant.plan_set_by_operator" } });
    expect(log.data).toMatchObject({ from: "trial", to: "pro", forced: false });
  });

  it("keeps a trial end that is still ahead when going back to a trial", async () => {
    const made = await createBusiness(db, { name: "Back Shop", adminEmail: "b@back.test", plan: "trial", trialDays: 40 }, now);
    await setPlan(db, made.tenant.id, "starter", {}, now);
    await db.tenant.update({ where: { id: made.tenant.id }, data: { trialEndsAt: new Date("2027-03-01T00:00:00Z") } });
    await setPlan(db, made.tenant.id, "trial", {}, now);
    expect((await db.tenant.findUniqueOrThrow({ where: { id: made.tenant.id } })).trialEndsAt).toEqual(new Date("2027-03-01T00:00:00Z"));
  });

  it("will not touch the internal business, an unconfirmed signup, or a Stripe-managed plan without --force", async () => {
    await db.tenant.update({ where: { id: t.a.tenantId }, data: { plan: "internal" } });
    await expect(setPlan(db, t.a.tenantId, "pro")).rejects.toThrow(/internal/);
    const pending = await db.tenant.create({ data: { name: "Pending Co", slug: "pending-co-1", status: "PENDING", plan: "trial", billingStatus: "TRIALING" } });
    await expect(setPlan(db, pending.id, "pro")).rejects.toThrow(/not confirmed/);
    const stripe = await db.tenant.create({ data: { name: "Stripe Co", slug: "stripe-co-1", status: "ACTIVE", plan: "starter", billingStatus: "ACTIVE", stripeSubscriptionId: "sub_test_1" } });
    await expect(setPlan(db, stripe.id, "pro")).rejects.toThrow(/Stripe subscription/);
    await expect(setPlan(db, stripe.id, "pro", { force: true })).resolves.toMatchObject({ to: "pro" });
    await expect(setPlan(db, "no-such-id", "pro")).rejects.toThrow(/No business/);
  });
});
