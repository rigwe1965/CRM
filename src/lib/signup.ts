import { randomBytes } from "node:crypto";
import { audit } from "@/lib/audit";
import { signupExistsEmail, verifySignupEmail, welcomeEmail } from "@/lib/email-templates";
import { appUrl, mailIsConsoleOnly, trySendMail } from "@/lib/mail";
import { hashPassword } from "@/lib/password";
import { TRIAL_DAYS } from "@/lib/plans";
import { acceptanceConfig, LEGAL_VERSION } from "@/lib/legal";
import { platformDb } from "@/lib/platform-db";
import { consumeSignupToken, createSignupToken } from "@/lib/tokens";

/** Self-service signup is off unless the owner switches it on, so a deployment opens to the public on purpose. */
export const signupEnabled = () => process.env.SIGNUP_ENABLED === "1" || process.env.SIGNUP_ENABLED === "true";

/**
 * Whether the signup response may carry the confirmation link (local development with no mail provider). It needs the
 * explicit SIGNUP_DEV_LINKS=1 on top of console-only mail, so a stray NODE_ENV can never hand the link to the visitor,
 * which would let anyone confirm a signup for an email address they do not own.
 */
export const devLinksEnabled = () => process.env.SIGNUP_DEV_LINKS === "1" && mailIsConsoleOnly();

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long an unconfirmed signup is kept before it is deleted. */
export const PENDING_SIGNUP_DAYS = 7;

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "business";

export type SignupInput = { businessName: string; name: string; email: string; password: string };

/**
 * Creates the business (PENDING, on a free trial) and its first admin, then emails the confirmation link. Nobody can
 * sign in until the link is used. An email that already has an account gets a notice instead and nothing is created, so
 * the caller can answer the same either way. Returns the link when no email provider is configured (development).
 */
export async function createSignup(input: SignupInput): Promise<{ devLink?: string }> {
  const existing = await platformDb.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) {
    await trySendMail({ to: input.email, ...signupExistsEmail() });
    return {};
  }
  const passwordHash = await hashPassword(input.password);
  const tenant = await platformDb.tenant.create({
    data: {
      name: input.businessName,
      slug: `${slugify(input.businessName)}-${randomBytes(3).toString("hex")}`,
      status: "PENDING",
      plan: "trial",
      billingStatus: "TRIALING",
      trialEndsAt: new Date(Date.now() + TRIAL_DAYS * DAY_MS),
      brandName: input.businessName,
      users: { create: { email: input.email, name: input.name, role: "ADMIN", passwordHash } },
      // Signing up is accepting the terms: recorded here, as the platform, so the in-app banner does not ask again.
      automationSettings: { create: { key: "legal", config: acceptanceConfig(null) } },
    },
    select: { id: true },
  });
  await audit({ email: input.email, tenantId: tenant.id }, { action: "signup.created", entity: "tenant", entityId: tenant.id, summary: input.businessName, data: { termsAccepted: LEGAL_VERSION } });
  const link = `${appUrl()}/verify-email?token=${await createSignupToken(input.email)}`;
  await trySendMail({ to: input.email, ...verifySignupEmail(input.name, input.businessName, link) });
  return { devLink: devLinksEnabled() ? link : undefined };
}

/** Confirms a signup from its emailed token: the business becomes ACTIVE. False when the link is invalid or used. */
export async function verifySignup(rawToken: string): Promise<boolean> {
  const email = await consumeSignupToken(rawToken);
  if (!email) return false;
  const user = await platformDb.user.findUnique({ where: { email }, select: { id: true, name: true, tenantId: true, tenant: { select: { status: true } } } });
  if (!user || user.tenant.status !== "PENDING") return false;
  await platformDb.$transaction([
    platformDb.tenant.update({ where: { id: user.tenantId }, data: { status: "ACTIVE" } }),
    platformDb.user.update({ where: { id: user.id }, data: { emailVerified: new Date() } }),
  ]);
  await audit({ id: user.id, email, tenantId: user.tenantId }, { action: "signup.verified", entity: "tenant", entityId: user.tenantId });
  await trySendMail({ to: email, ...welcomeEmail(user.name) });
  return true;
}

/**
 * Deletes signups nobody confirmed. Only PENDING businesses are touched, and a PENDING business can hold nothing but
 * its first user, so there is no customer data to lose. Returns how many were removed.
 */
export async function purgeUnconfirmedSignups(now = new Date()): Promise<number> {
  const old = await platformDb.tenant.findMany({ where: { status: "PENDING", createdAt: { lt: new Date(now.getTime() - PENDING_SIGNUP_DAYS * DAY_MS) } }, select: { id: true } });
  for (const { id } of old) {
    await platformDb.$transaction([platformDb.user.deleteMany({ where: { tenantId: id } }), platformDb.tenant.deleteMany({ where: { id, status: "PENDING" } })]);
  }
  return old.length;
}
