import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { platformDb } from "@/lib/platform-db";
import { withTenant } from "@/lib/tenant-context";
import { decryptSecret, encryptSecret } from "@/lib/mfa";
import { appUrl } from "@/lib/mail";

/**
 * Private links a customer opens to see one order (Plan A, customer payment page). The link carries a random
 * token; only its SHA-256 is used to find the row, and an encrypted copy lets staff and reminders show the same
 * link again. A business has one live link per order: making a new one revokes the old one.
 */
export const DEFAULT_LINK_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 32 random bytes as base64url: 43 characters, far too many to guess. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");
/** The address a customer opens. Built from the configured site address only, never from the request's Host header. */
export const orderLinkUrl = (token: string) => `${appUrl()}/my-order/${token}`;

export type OrderLinkDto = {
  id: string;
  status: "ACTIVE" | "EXPIRED" | "REVOKED";
  /** The address to give the customer; null only if the stored copy can no longer be read (make a new link). */
  url: string | null;
  createdAt: Date;
  expiresAt: Date;
  lastViewedAt: Date | null;
  viewCount: number;
};

type Row = { id: string; tokenSealed: string; expiresAt: Date; revokedAt: Date | null; lastViewedAt: Date | null; viewCount: number; createdAt: Date };

function toDto(row: Row, now: Date): OrderLinkDto {
  let url: string | null = null;
  try {
    url = orderLinkUrl(decryptSecret(row.tokenSealed));
  } catch (e) {
    console.error("[order-link] stored link unreadable", row.id, e instanceof Error ? e.message : e);
  }
  return {
    id: row.id,
    status: row.revokedAt ? "REVOKED" : row.expiresAt <= now ? "EXPIRED" : "ACTIVE",
    // A closed link is no use to anyone, so its address is not handed out.
    url: row.revokedAt || row.expiresAt <= now ? null : url,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lastViewedAt: row.lastViewedAt,
    viewCount: row.viewCount,
  };
}

/** The order's newest link, whatever its state, or null if it never had one. Caller must have checked access to the deal. */
export async function currentOrderLink(tenantId: string, dealId: string, now = new Date()): Promise<OrderLinkDto | null> {
  const row = await db.customerOrderLink.findFirst({ where: { tenantId, dealId }, orderBy: { createdAt: "desc" } });
  return row ? toDto(row, now) : null;
}

/**
 * Makes a new link for the order and revokes any earlier one, so there is never more than one way in. Caller must
 * have checked access to the deal. Returns the new link with its address.
 */
export async function createOrderLink(user: { id: string; tenantId: string }, dealId: string, expiresInDays = DEFAULT_LINK_DAYS, now = new Date()): Promise<OrderLinkDto> {
  const token = newToken();
  const row = await db.$transaction(async (tx) => {
    await tx.customerOrderLink.updateMany({ where: { tenantId: user.tenantId, dealId, revokedAt: null }, data: { revokedAt: now } });
    return tx.customerOrderLink.create({
      data: {
        tenantId: user.tenantId,
        dealId,
        tokenHash: hashToken(token),
        tokenSealed: encryptSecret(token),
        expiresAt: new Date(now.getTime() + expiresInDays * DAY_MS),
        createdById: user.id,
      },
    });
  });
  return toDto(row, now);
}

/**
 * The address a reminder carries: the order's live link, or a new one when it has none (so a reminder never replaces
 * a link the customer already holds). Never throws: on any failure it returns null and the reminder falls back to
 * the plain payment link. Caller runs as the business.
 */
export async function reminderOrderLink(user: { id: string; tenantId: string }, dealId: string, now = new Date()): Promise<string | null> {
  try {
    const current = await currentOrderLink(user.tenantId, dealId, now);
    if (current?.status === "ACTIVE" && current.url) return current.url;
    return (await createOrderLink(user, dealId, DEFAULT_LINK_DAYS, now)).url;
  } catch (e) {
    console.error("[order-link] reminder link skipped", dealId, e instanceof Error ? e.message : e);
    return null;
  }
}

/** Switches the order's link off at once. Returns whether there was a live link to revoke. */
export async function revokeOrderLink(tenantId: string, dealId: string, now = new Date()): Promise<boolean> {
  const { count } = await db.customerOrderLink.updateMany({ where: { tenantId, dealId, revokedAt: null }, data: { revokedAt: now } });
  return count > 0;
}

/**
 * Finds the order a visitor's token opens: the business and the deal, or null for anything that is not a live link
 * (malformed, unknown, revoked, expired, deleted order, suspended business). Callers must answer every null the same
 * way, so a visitor learns nothing about why. The token alone names the business, so this is the one place that looks
 * across businesses; from here on callers run as that business (`withTenant`).
 */
export async function resolveOrderLink(token: string, now = new Date()): Promise<{ linkId: string; tenantId: string; dealId: string } | null> {
  if (!TOKEN_SHAPE.test(token)) return null;
  const found = await platformDb.customerOrderLink.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, tenantId: true, dealId: true, expiresAt: true, revokedAt: true },
  });
  if (!found || found.revokedAt || found.expiresAt <= now) return null;
  const { tenantId, dealId } = found;
  const [business, deal] = await withTenant(tenantId, () =>
    Promise.all([
      db.tenant.findFirst({ where: { id: tenantId, status: "ACTIVE" }, select: { id: true } }),
      db.deal.findFirst({ where: { id: dealId, tenantId, deletedAt: null }, select: { id: true } }),
    ]),
  );
  return business && deal ? { linkId: found.id, tenantId, dealId } : null;
}

/** Counts a visit. Runs as the business (inside `withTenant`). Never throws: a failed counter must not hide the order. */
export async function recordOrderLinkView(tenantId: string, linkId: string, now = new Date()): Promise<void> {
  try {
    await db.customerOrderLink.updateMany({ where: { id: linkId, tenantId }, data: { lastViewedAt: now, viewCount: { increment: 1 } } });
  } catch (e) {
    console.error("[order-link] view not counted", linkId, e instanceof Error ? e.message : e);
  }
}
