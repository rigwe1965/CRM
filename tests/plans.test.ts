import { describe, expect, it } from "vitest";
import { accessOf, allowedWhenReadOnly, PLANS, planOf, type TenantBilling } from "@/lib/plans";

// Phase 4 of MULTI_TENANCY_PLAN.md: what a business may do, from its row alone.

const NOW = new Date("2026-11-01T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const t = (over: Partial<TenantBilling> = {}): TenantBilling => ({ status: "ACTIVE", plan: "starter", billingStatus: "ACTIVE", trialEndsAt: null, currentPeriodEnd: null, ...over });

describe("accessOf", () => {
  it("never limits or locks the original business", () => {
    const a = accessOf(t({ plan: "internal", billingStatus: "CANCELED" }), NOW);
    expect(a).toMatchObject({ active: true, writable: true, reason: null });
    expect(a.limits.users).toBe(Infinity);
  });

  it("lets a trial write until it ends, then goes read-only", () => {
    expect(accessOf(t({ plan: "trial", billingStatus: "TRIALING", trialEndsAt: day(3) }), NOW)).toMatchObject({ writable: true });
    expect(accessOf(t({ plan: "trial", billingStatus: "TRIALING", trialEndsAt: day(-1) }), NOW)).toMatchObject({ active: true, writable: false, reason: "trial_ended" });
    expect(accessOf(t({ plan: "trial", billingStatus: "TRIALING", trialEndsAt: null }), NOW).writable).toBe(false);
  });

  it("keeps a paying or failing-to-pay business working (Stripe decides when to cancel)", () => {
    expect(accessOf(t({ billingStatus: "ACTIVE" }), NOW).writable).toBe(true);
    expect(accessOf(t({ billingStatus: "PAST_DUE" }), NOW).writable).toBe(true);
  });

  it("keeps a cancelled business working until the period it paid for ends", () => {
    expect(accessOf(t({ billingStatus: "CANCELED", currentPeriodEnd: day(5) }), NOW).writable).toBe(true);
    expect(accessOf(t({ billingStatus: "CANCELED", currentPeriodEnd: day(-1) }), NOW)).toMatchObject({ active: true, writable: false, reason: "canceled" });
    expect(accessOf(t({ billingStatus: "CANCELED" }), NOW).writable).toBe(false);
  });

  it("locks a suspended or unconfirmed business out entirely", () => {
    for (const status of ["SUSPENDED", "PENDING"] as const) {
      expect(accessOf(t({ status }), NOW)).toMatchObject({ active: false, writable: false });
    }
  });

  it("gives each plan its limits, and treats an unknown plan as the trial", () => {
    expect(accessOf(t({ plan: "pro" }), NOW).limits).toEqual(PLANS.pro.limits);
    expect(planOf("whatever")).toBe("trial");
    expect(PLANS.pro.limits.users).toBeGreaterThan(PLANS.starter.limits.users);
  });
});

describe("deletion pending", () => {
  it("makes even an internal or paid business read-only, but still active so it can export", () => {
    for (const plan of ["internal", "starter"]) {
      expect(accessOf(t({ plan, deletionRequestedAt: NOW }), NOW)).toMatchObject({ active: true, writable: false, reason: "deletion_pending" });
    }
    expect(accessOf(t({ status: "SUSPENDED", deletionRequestedAt: NOW }), NOW)).toMatchObject({ active: false, reason: "suspended" });
  });
});

describe("daily caps", () => {
  it("grow with the plan, and the internal plan has none", () => {
    expect(PLANS.trial.daily.emails).toBeLessThan(PLANS.starter.daily.emails);
    expect(PLANS.starter.daily.emails).toBeLessThan(PLANS.pro.daily.emails);
    expect(PLANS.internal.daily).toEqual({ emails: Infinity, whatsapp: Infinity });
  });
});

describe("read-only mode", () => {
  it("still lets a business pay and manage its own account", () => {
    expect(allowedWhenReadOnly("/api/billing/checkout")).toBe(true);
    expect(allowedWhenReadOnly("/api/billing")).toBe(true);
    expect(allowedWhenReadOnly("/api/me/password")).toBe(true);
    expect(allowedWhenReadOnly("/api/export/full")).toBe(true);
    expect(allowedWhenReadOnly("/api/admin/tenant/deletion")).toBe(true);
    expect(allowedWhenReadOnly("/api/admin/tenant")).toBe(false);
    expect(allowedWhenReadOnly("/api/contacts")).toBe(false);
    expect(allowedWhenReadOnly("/api/billingfoo")).toBe(false);
  });
});
