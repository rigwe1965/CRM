import { Resend } from "resend";
import { ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { FROM, fromWithName } from "@/lib/mail";
import { platformDb } from "@/lib/platform-db";
import { Prisma } from "@prisma/client";

/**
 * A sender address per business (Phase 5 follow-up of MULTI_TENANCY_PLAN.md). A business that owns a domain can send
 * the mail it triggers for its own customers (contact emails, instalment reminders) from `hello@its-domain.com`
 * instead of the platform's shared address. Needs Resend (RESEND_API_KEY): the business adds the domain, publishes
 * the DNS records Resend gives it, and verifies. Ownership is proved by those DNS records, not by what the business
 * types; a domain can belong to one business only. Mail about the account itself (invites, sign-in and confirmation
 * links, billing) always goes from EMAIL_FROM.
 */
export const senderAvailable = () => !!process.env.RESEND_API_KEY;

let client: Resend | undefined;
const resend = () => {
  if (!process.env.RESEND_API_KEY) throw new ApiError(503, "A sender address needs the Resend email provider, which is not set up on this CRM.", "NOT_CONFIGURED");
  return (client ??= new Resend(process.env.RESEND_API_KEY));
};

// Domains anyone can send from or that belong to mailbox providers: a business can never prove it owns them.
const SHARED_DOMAINS = new Set(["gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.de", "mail.com", "zoho.com", "yandex.com"]);
const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const LOCAL = /^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$/;

/** The platform's own sending domain, which no business may claim. */
const platformDomain = () => (FROM.match(/@([^>\s]+)>?\s*$/)?.[1] ?? "").toLowerCase();

export function checkSender(input: { domain: string; localPart: string }) {
  const domain = input.domain.trim().toLowerCase();
  const localPart = input.localPart.trim().toLowerCase();
  const bad = (field: string, message: string) => new ApiError(422, message, "VALIDATION_ERROR", { [field]: [message] });
  if (!DOMAIN.test(domain)) throw bad("domain", "Enter a domain like mail.yourshop.com (no @, no https://)");
  if (SHARED_DOMAINS.has(domain) || domain === platformDomain() || platformDomain().endsWith(`.${domain}`)) throw bad("domain", "Use a domain your business owns, not a mailbox provider's or this CRM's");
  if (!LOCAL.test(localPart) || localPart.includes("..")) throw bad("localPart", "Letters, numbers, dots, dashes and underscores only, like hello or orders");
  return { domain, localPart };
}

export type SenderView = {
  available: boolean;
  domain: string | null;
  localPart: string | null;
  address: string | null;
  status: "none" | "pending" | "verified" | "failed";
  records: { record: string; type: string; name: string; value: string; priority?: number; status: string }[];
};

const empty = (available: boolean): SenderView => ({ available, domain: null, localPart: null, address: null, status: "none", records: [] });

/** The Settings screen's data. Live DNS state comes from Resend while the domain is not verified yet. Runs in the business's context. */
export async function senderView(tenantId: string): Promise<SenderView> {
  const t = await db.tenant.findFirstOrThrow({ where: { id: tenantId }, select: { senderDomain: true, senderLocalPart: true, senderDomainId: true, senderVerifiedAt: true } });
  const view = empty(senderAvailable());
  if (!t.senderDomain || !t.senderLocalPart) return view;
  view.domain = t.senderDomain;
  view.localPart = t.senderLocalPart;
  view.address = `${t.senderLocalPart}@${t.senderDomain}`;
  view.status = t.senderVerifiedAt ? "verified" : "pending";
  if (!t.senderVerifiedAt && t.senderDomainId && senderAvailable()) {
    const { data } = await resend().domains.get(t.senderDomainId).catch(() => ({ data: null }));
    if (data) {
      view.status = data.status === "failed" || data.status === "partially_failed" ? "failed" : "pending";
      view.records = data.records.filter((r) => r.record === "SPF" || r.record === "DKIM").map((r) => ({ record: r.record, type: r.type, name: r.name, value: r.value, priority: r.priority, status: r.status }));
    }
  }
  return view;
}

/** Saves the address, registering a new domain with Resend (and dropping the old one). Not usable until verified. */
export async function setSender(tenantId: string, input: { domain: string; localPart: string }) {
  const { domain, localPart } = checkSender(input);
  const current = await platformDb.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { senderDomain: true, senderDomainId: true } });
  let domainId = current.senderDomainId;
  let verifiedAt: Date | null | undefined; // undefined = unchanged
  if (current.senderDomain !== domain) {
    const created = await resend().domains.create({ name: domain });
    if (created.error || !created.data) throw new ApiError(409, `Could not register that domain: ${created.error?.message ?? "unknown error"}`, "DOMAIN_REJECTED");
    domainId = created.data.id;
    verifiedAt = null;
    if (current.senderDomainId) await resend().domains.remove(current.senderDomainId).catch((e) => console.error("[sender] old domain not removed", e instanceof Error ? e.message : e));
  }
  try {
    await platformDb.tenant.update({ where: { id: tenantId }, data: { senderDomain: domain, senderLocalPart: localPart, senderDomainId: domainId, ...(verifiedAt !== undefined && { senderVerifiedAt: verifiedAt, senderClaimedAt: new Date() }) } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      if (domainId && domainId !== current.senderDomainId) await resend().domains.remove(domainId).catch(() => undefined);
      throw new ApiError(409, "That domain is already used by another business.", "DOMAIN_TAKEN", { domain: ["That domain is already used by another business"] });
    }
    throw e;
  }
}

/** Asks Resend to check the DNS records and records the outcome. */
export async function verifySender(tenantId: string) {
  const t = await platformDb.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { senderDomainId: true } });
  if (!t.senderDomainId) throw new ApiError(409, "Save a domain first.", "NO_DOMAIN");
  const r = resend();
  await r.domains.verify(t.senderDomainId);
  const { data } = await r.domains.get(t.senderDomainId);
  if (!data) throw new ApiError(502, "The email provider did not answer. Try again in a minute.", "PROVIDER_FAILED");
  await platformDb.tenant.update({ where: { id: tenantId }, data: { senderVerifiedAt: data.status === "verified" ? new Date() : null } });
}

export async function removeSender(tenantId: string) {
  const t = await platformDb.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { senderDomainId: true } });
  if (t.senderDomainId && senderAvailable()) await resend().domains.remove(t.senderDomainId).catch((e) => console.error("[sender] domain not removed", e instanceof Error ? e.message : e));
  await platformDb.tenant.update({ where: { id: tenantId }, data: { senderDomain: null, senderLocalPart: null, senderDomainId: null, senderVerifiedAt: null, senderClaimedAt: null } });
}

/** How long a domain can be held without proving ownership. */
export const SENDER_CLAIM_DAYS = 7;

/**
 * Daily: lets go of domains that were claimed but never verified within a week, so a business cannot sit on someone
 * else's domain name. Verified domains are never touched. Returns how many were released.
 */
export async function releaseStaleSenderClaims(now = new Date()): Promise<number> {
  const stale = await platformDb.tenant.findMany({
    where: { senderDomain: { not: null }, senderVerifiedAt: null, senderClaimedAt: { lt: new Date(now.getTime() - SENDER_CLAIM_DAYS * 86_400_000) } },
    select: { id: true },
  });
  for (const { id } of stale) await removeSender(id).catch((e) => console.error("[sender] stale claim not released", id, e instanceof Error ? e.message : e));
  return stale.length;
}

/**
 * The From header for mail a business sends to its customers: its own verified address with `displayName`, otherwise the
 * shared platform address with that name. Must run in the business's context.
 */
export async function senderFor(tenantId: string, displayName: string): Promise<string> {
  const t = await db.tenant.findFirst({ where: { id: tenantId }, select: { senderDomain: true, senderLocalPart: true, senderVerifiedAt: true } });
  if (!t?.senderVerifiedAt || !t.senderDomain || !t.senderLocalPart) return fromWithName(displayName);
  const display = displayName.replace(/["<>\r\n\\]/g, "").trim() || "CRM";
  return `"${display}" <${t.senderLocalPart}@${t.senderDomain}>`;
}
