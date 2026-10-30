import type { BillingStatus, TenantStatus } from "@prisma/client";

/**
 * Plans and what a business may do right now (Phase 4 of MULTI_TENANCY_PLAN.md). Pure functions with no database, so
 * the middleware-free rules are easy to test. Limits and the trial length are the owner's to change here.
 */
export const TRIAL_DAYS = Number(process.env.TRIAL_DAYS) > 0 ? Number(process.env.TRIAL_DAYS) : 14;

export type PlanKey = "internal" | "trial" | "starter" | "pro";
export type Limits = { users: number; contacts: number };
/** Messages a business may send per day through the CRM (Phase 5): contains abuse and what it costs us. */
export type DailyCaps = { emails: number; whatsapp: number };

export const PLANS: Record<PlanKey, { label: string; limits: Limits; daily: DailyCaps; priceEnv?: string }> = {
  internal: { label: "Internal", limits: { users: Infinity, contacts: Infinity }, daily: { emails: Infinity, whatsapp: Infinity } },
  trial: { label: "Free trial", limits: { users: 3, contacts: 1000 }, daily: { emails: 50, whatsapp: 25 } },
  starter: { label: "Starter", limits: { users: 3, contacts: 1000 }, daily: { emails: 200, whatsapp: 100 }, priceEnv: "BILLING_PRICE_STARTER" },
  pro: { label: "Pro", limits: { users: 15, contacts: 25000 }, daily: { emails: 1000, whatsapp: 500 }, priceEnv: "BILLING_PRICE_PRO" },
};

export const planOf = (plan: string): PlanKey => (plan in PLANS ? (plan as PlanKey) : "trial");
export const PAID_PLANS = ["starter", "pro"] as const;

export type TenantBilling = {
  status: TenantStatus;
  plan: string;
  billingStatus: BillingStatus;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  /** Set once an admin has asked to delete the business. */
  deletionRequestedAt?: Date | null;
};

export type Access = {
  /** May the business use the app at all (sign in, read)? */
  active: boolean;
  /** May it change data? False in read-only mode: an unpaid, cancelled or expired business can still read and export. */
  writable: boolean;
  /** Why it is read-only, for the banner. */
  reason: "trial_ended" | "canceled" | "suspended" | "deletion_pending" | null;
  limits: Limits;
};

/** What a business can do at `now`, from its row. */
export function accessOf(t: TenantBilling, now = new Date()): Access {
  const key = planOf(t.plan);
  const limits = PLANS[key].limits;
  if (t.status !== "ACTIVE") return { active: false, writable: false, reason: "suspended", limits };
  // A business waiting to be erased can only read, export, or change its mind.
  if (t.deletionRequestedAt) return { active: true, writable: false, reason: "deletion_pending", limits };
  if (key === "internal") return { active: true, writable: true, reason: null, limits };
  switch (t.billingStatus) {
    case "ACTIVE":
    case "PAST_DUE": // Stripe retries the card for a while; cancelling is Stripe's call, not ours
      return { active: true, writable: true, reason: null, limits };
    case "TRIALING":
      return t.trialEndsAt && t.trialEndsAt > now ? { active: true, writable: true, reason: null, limits } : { active: true, writable: false, reason: "trial_ended", limits };
    case "CANCELED":
      // A cancelled subscription is paid up to the end of its period.
      return t.currentPeriodEnd && t.currentPeriodEnd > now ? { active: true, writable: true, reason: null, limits } : { active: true, writable: false, reason: "canceled", limits };
  }
}

/**
 * Paths a read-only business may still write to: paying, exporting its data, cancelling its deletion, the signed-in
 * user's own account, and chatting with Ivy (which only reads business data; its chats are the user's own).
 */
export const READ_ONLY_ALLOWED = ["/api/billing", "/api/me", "/api/export", "/api/admin/tenant/deletion", "/api/assistant"] as const;
export const allowedWhenReadOnly = (pathname: string) => READ_ONLY_ALLOWED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
