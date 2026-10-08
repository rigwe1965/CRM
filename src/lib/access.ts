import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import type { SessionUser } from "@/lib/auth-helpers";

/**
 * Data-ownership rules ("own data unless admin"):
 *  - Organizations, contacts, deals: visible/editable by their owner (ownerId).
 *  - Activities: by their author. Tasks: by their assignee or creator.
 *  - ADMIN sees and edits everything and may also list soft-deleted rows.
 * SALES and SUPPORT have the same data scope.
 */
export const isAdmin = (user: SessionUser) => user.role === "ADMIN";

export const ownerScope = (user: SessionUser): { ownerId?: string } =>
  isAdmin(user) ? {} : { ownerId: user.id };

export const authorScope = (user: SessionUser): { authorId?: string } =>
  isAdmin(user) ? {} : { authorId: user.id };

export const taskScope = (user: SessionUser): Prisma.TaskWhereInput =>
  isAdmin(user) ? {} : { OR: [{ assigneeId: user.id }, { createdById: user.id }] };

/** Soft-delete filter: only admins can opt in to deleted rows. */
export const liveFilter = (user: SessionUser, includeDeleted?: boolean) =>
  isAdmin(user) && includeDeleted ? {} : { deletedAt: null };

/**
 * Resolves who owns a record being created/updated.
 *  - undefined → current user.
 *  - Admins may assign anyone active (or null for "unassigned" where the schema allows it).
 *  - Everyone else may only assign themselves.
 */
export async function resolveOwner(
  user: SessionUser,
  requested: string | null | undefined,
): Promise<string | null> {
  if (requested === undefined) return user.id;
  if (requested === null) {
    if (!isAdmin(user)) throw new ApiError(403, "Only admins can leave a record unassigned");
    return null;
  }
  if (requested === user.id) return user.id;
  if (!isAdmin(user)) throw new ApiError(403, "You can only assign records to yourself");
  const target = await db.user.findFirst({ where: { id: requested, isActive: true }, select: { id: true } });
  if (!target) {
    throw new ApiError(422, "User not found", "INVALID_REFERENCE", { ownerId: ["User not found"] });
  }
  return target.id;
}

/** Ensures linked records exist and are visible to the caller; prevents linking to other users' data. */
export async function assertLinks(
  user: SessionUser,
  links: { organizationId?: string | null; contactId?: string | null; dealId?: string | null },
) {
  const scope = ownerScope(user);
  const checks: Array<Promise<string | null>> = [];
  if (links.organizationId) {
    checks.push(
      db.organization
        .findFirst({ where: { id: links.organizationId, deletedAt: null, ...scope }, select: { id: true } })
        .then((r) => (r ? null : "organizationId")),
    );
  }
  if (links.contactId) {
    checks.push(
      db.contact
        .findFirst({ where: { id: links.contactId, deletedAt: null, ...scope }, select: { id: true } })
        .then((r) => (r ? null : "contactId")),
    );
  }
  if (links.dealId) {
    checks.push(
      db.deal
        .findFirst({ where: { id: links.dealId, deletedAt: null, ...scope }, select: { id: true } })
        .then((r) => (r ? null : "dealId")),
    );
  }
  const missing = (await Promise.all(checks)).filter((f): f is string => f !== null);
  if (missing.length) {
    throw new ApiError(
      422,
      "A referenced record was not found",
      "INVALID_REFERENCE",
      Object.fromEntries(missing.map((f) => [f, ["Record not found"]])),
    );
  }
}

export const notFound = (what: string) => new ApiError(404, `${what} not found`);

/** True when this change would take away the last active admin (demoting or deactivating one). */
export function wouldLeaveNoAdmin(opts: {
  target: { role: string; isActive: boolean };
  demoting: boolean;
  deactivating: boolean;
  otherActiveAdmins: number;
}) {
  const losesAdmin = opts.target.role === "ADMIN" && opts.target.isActive && (opts.demoting || opts.deactivating);
  return losesAdmin && opts.otherActiveAdmins === 0;
}

/** Name shown in notification emails (session fields are typed as optional by Auth.js). */
export const displayName = (user: SessionUser) => user.name || user.email || "A teammate";
