// The platform owner's operations on businesses, kept apart from the command line so they can be tested.
// They take a database client that is NOT held back by row-level security (the owner role), like the script itself.
import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export const PLAN_CHOICES = ["trial", "starter", "pro"] as const;
export type PlanChoice = (typeof PLAN_CHOICES)[number];

export const INVITE_DAYS = 7;
export const DEFAULT_TRIAL_DAYS = 14;
const DAY_MS = 86_400_000;

export const isPlanChoice = (v: unknown): v is PlanChoice => (PLAN_CHOICES as readonly unknown[]).includes(v);

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "business";

/** The same simple check the sign-up form applies; the script refuses anything else rather than guessing. */
const EMAIL = /^[^\s@<>"',;:]+@[^\s@<>"',;:]+\.[^\s@<>"',;:]{2,}$/;

/**
 * What a business's billing columns must be for a plan. A trial is time-limited; a paid plan set by hand (a pilot, or
 * a customer paying outside Stripe) is simply active. NEVER leave `plan` unset: the column's default is "internal",
 * which means unlimited and never read-only.
 */
export function billingFor(plan: PlanChoice, now: Date, trialDays = DEFAULT_TRIAL_DAYS) {
  if (plan === "trial") return { plan, billingStatus: "TRIALING" as const, trialEndsAt: new Date(now.getTime() + trialDays * DAY_MS) };
  return { plan, billingStatus: "ACTIVE" as const, trialEndsAt: null };
}

/** Stores a set-password link for the invited admin, in the format the app's reset page accepts (src/lib/tokens.ts). Returns the raw token. */
export async function issueInvite(db: Pick<PrismaClient, "$transaction" | "verificationToken">, email: string, now = new Date()): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  const identifier = `reset:${email}`;
  await db.$transaction([
    db.verificationToken.deleteMany({ where: { identifier } }),
    db.verificationToken.create({ data: { identifier, token: createHash("sha256").update(raw).digest("hex"), expires: new Date(now.getTime() + INVITE_DAYS * DAY_MS) } }),
  ]);
  return raw;
}

export type CreateInput = { name: string; adminEmail: string; adminName?: string; plan: PlanChoice; trialDays?: number };

/**
 * Creates a business that is ACTIVE at once (no email confirmation: you are vouching for it) with its first admin, who
 * has no password yet and sets one from the invite link. Writes an audit entry. The admin is asked to accept the terms
 * on first sign-in, like any business made by hand.
 */
export async function createBusiness(db: PrismaClient, input: CreateInput, now = new Date()) {
  const name = input.name.trim();
  const email = input.adminEmail.trim().toLowerCase();
  if (name.length < 2 || name.length > 100) throw new Error("The business name must be 2 to 100 characters");
  if (!EMAIL.test(email)) throw new Error(`"${input.adminEmail}" is not an email address`);
  if (!isPlanChoice(input.plan)) throw new Error(`The plan must be one of: ${PLAN_CHOICES.join(", ")}`);
  if (input.trialDays !== undefined && (!Number.isInteger(input.trialDays) || input.trialDays < 1 || input.trialDays > 365)) throw new Error("--trial-days needs a whole number from 1 to 365");
  if (await db.user.findUnique({ where: { email }, select: { id: true } })) throw new Error(`${email} already has an account (an email can belong to one business only)`);

  const tenant = await db.tenant.create({
    data: {
      name,
      brandName: name,
      slug: `${slugify(name)}-${randomBytes(3).toString("hex")}`,
      status: "ACTIVE",
      ...billingFor(input.plan, now, input.trialDays),
      users: { create: { email, name: input.adminName?.trim() || email.split("@")[0], role: "ADMIN" } },
    },
    select: { id: true, name: true, plan: true },
  });
  await db.auditLog.create({ data: { tenantId: tenant.id, actorEmail: "tenant-admin", action: "tenant.created_by_operator", entity: "tenant", entityId: tenant.id, summary: `${name} (${input.plan}), admin ${email}` } });
  const token = await issueInvite(db, email, now);
  return { tenant, email, token };
}

/**
 * Moves a business to another plan by hand (a pilot, or a customer who pays outside Stripe). Refused for the internal
 * business, for a signup still waiting to confirm, and for a business that has a Stripe subscription (Stripe's events
 * own its plan and a hand edit would be overwritten) unless `force` is given.
 */
export async function setPlan(db: PrismaClient, id: string, plan: PlanChoice, opts: { force?: boolean } = {}, now = new Date()) {
  if (!isPlanChoice(plan)) throw new Error(`The plan must be one of: ${PLAN_CHOICES.join(", ")}`);
  const tenant = await db.tenant.findUnique({ where: { id } });
  if (!tenant) throw new Error(`No business with id ${id}`);
  if (tenant.plan === "internal") throw new Error("That is the internal business: it is never limited and its plan is not changed here");
  if (tenant.status === "PENDING") throw new Error("That signup has not confirmed its email yet");
  if (tenant.stripeSubscriptionId && !opts.force) throw new Error("That business has a Stripe subscription: its plan follows Stripe. Pass --force only if you are sure");
  // Going back to a trial keeps a trial end that is still ahead, so a stray command cannot shorten a paying pilot's time to nothing.
  const data = billingFor(plan, now);
  const keep = plan === "trial" && tenant.trialEndsAt && tenant.trialEndsAt > now ? { trialEndsAt: tenant.trialEndsAt } : {};
  await db.tenant.update({ where: { id }, data: { ...data, ...keep } });
  await db.auditLog.create({ data: { tenantId: id, actorEmail: "tenant-admin", action: "tenant.plan_set_by_operator", entity: "tenant", entityId: id, summary: `${tenant.plan} to ${plan}`, data: { from: tenant.plan, to: plan, forced: !!opts.force } } });
  return { name: tenant.name, from: tenant.plan, to: plan };
}
