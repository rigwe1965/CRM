import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { db } from "@/lib/db";
import { liveFilter, ownerScope } from "@/lib/access";
import type { SessionUser } from "@/lib/auth-helpers";
import { listing, type ExportEntity, type WithDeleted } from "@/lib/export/define";
import { exportAuditQuery, exportContactsQuery } from "@/lib/validations/crm";

/**
 * Areas only admins may export. They hold the most personal data, so they live apart from the
 * everyday areas: contacts (names, emails, phones, addresses) and the audit log (who did what, from
 * where, with snapshots of deleted records). The audit log also needs a fresh authenticator code.
 */

const person = { select: { name: true } } as const;

const contactWhere = (user: SessionUser, q: WithDeleted<z.infer<typeof exportContactsQuery>>): Prisma.ContactWhereInput => ({
  AND: [
    liveFilter(user, q.includeDeleted),
    ownerScope(user),
    {
      ...(q.ids && { id: { in: q.ids } }),
      ...(q.tag && { tags: { some: { tagId: q.tag } } }),
      ...(q.type && { type: { in: q.type } }),
      ...(q.leadStatus && { leadStatus: { in: q.leadStatus } }),
      ...(q.organizationId && { organizationId: q.organizationId }),
      ...(q.ownerId && { ownerId: q.ownerId }),
      ...(q.q && {
        OR: [
          { firstName: { contains: q.q, mode: "insensitive" } },
          { lastName: { contains: q.q, mode: "insensitive" } },
          { email: { contains: q.q, mode: "insensitive" } },
          { phone: { contains: q.q } },
        ],
      }),
    },
  ],
});

const contacts = listing({
  file: "contacts",
  adminOnly: true,
  softDeleted: true,
  schema: exportContactsQuery,
  count: (user, q) => db.contact.count({ where: contactWhere(user, q) }),
  fetch: (user, q, page) =>
    db.contact.findMany({
      where: contactWhere(user, q),
      select: {
        id: true, firstName: true, lastName: true, email: true, phone: true, title: true, type: true,
        leadStatus: true, source: true, address: true, city: true, state: true, postalCode: true, country: true,
        deletedAt: true, createdAt: true, updatedAt: true,
        organization: person, owner: person,
      },
      orderBy:
        q.sort === "name"
          ? [{ lastName: q.order }, { firstName: q.order }, { id: "asc" }]
          : [{ [q.sort]: q.order }, { id: "asc" }],
      ...page,
    }),
  columns: [
    ["id", (c) => c.id], ["firstName", (c) => c.firstName], ["lastName", (c) => c.lastName], ["email", (c) => c.email],
    ["phone", (c) => c.phone], ["title", (c) => c.title], ["type", (c) => c.type], ["leadStatus", (c) => c.leadStatus],
    ["source", (c) => c.source], ["address", (c) => c.address], ["city", (c) => c.city], ["state", (c) => c.state],
    ["postalCode", (c) => c.postalCode], ["country", (c) => c.country],
    ["organization", (c) => c.organization?.name], ["owner", (c) => c.owner?.name],
    ["deletedAt", (c) => c.deletedAt], ["createdAt", (c) => c.createdAt], ["updatedAt", (c) => c.updatedAt],
  ],
});

const auditWhere = (q: z.infer<typeof exportAuditQuery>): Prisma.AuditLogWhereInput => ({
  ...((q.from || q.to) && { createdAt: { gte: q.from, lte: q.to } }),
  ...(q.q && {
    OR: [
      { action: { contains: q.q, mode: "insensitive" } },
      { actorEmail: { contains: q.q, mode: "insensitive" } },
      { summary: { contains: q.q, mode: "insensitive" } },
      { entityId: q.q },
    ],
  }),
});

const audit = listing({
  file: "audit-log",
  adminOnly: true,
  stepUp: true,
  schema: exportAuditQuery,
  count: (_user, q) => db.auditLog.count({ where: auditWhere(q) }),
  fetch: (_user, q, page) =>
    db.auditLog.findMany({
      where: auditWhere(q),
      select: {
        id: true, createdAt: true, actorId: true, actorEmail: true, action: true, entity: true,
        entityId: true, summary: true, ip: true, data: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      ...page,
    }),
  columns: [
    ["id", (a) => a.id], ["createdAt", (a) => a.createdAt], ["actorId", (a) => a.actorId], ["actorEmail", (a) => a.actorEmail],
    ["action", (a) => a.action], ["entity", (a) => a.entity], ["entityId", (a) => a.entityId], ["summary", (a) => a.summary],
    ["ip", (a) => a.ip], ["data", (a) => (a.data === null ? "" : JSON.stringify(a.data))],
  ],
});

export const ADMIN_EXPORTS: Readonly<Record<string, ExportEntity>> = { contacts, "audit-log": audit };
