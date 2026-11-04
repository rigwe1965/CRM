import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import type { SessionUser } from "@/lib/auth-helpers";
import { tenantScope } from "@/lib/access";
import { DEFAULT_POLICY } from "@/lib/ai/knowledge/ivycandy-policy";
import { DEFAULT_FAQ } from "@/lib/ai/knowledge/ivycandy-faq";
import { knowledgeInput, knowledgePatch, type KnowledgeInput } from "@/lib/ai/knowledge/types";

/** Adding, editing, archiving and importing knowledge entries. Every change keeps a version row. Admin routes call these inside the business's context. */

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export const listEntries = (user: Pick<SessionUser, "tenantId">) =>
  db.knowledgeEntry.findMany({ where: tenantScope(user), orderBy: [{ category: "asc" }, { title: "asc" }] });

export const entryHistory = (user: Pick<SessionUser, "tenantId">, id: string) =>
  db.knowledgeEntryVersion.findMany({ where: { ...tenantScope(user), entryId: id }, orderBy: { version: "desc" }, take: 50 });

async function assertNotDuplicate(user: Pick<SessionUser, "tenantId">, title: string, body: string, exceptId?: string) {
  const live = await db.knowledgeEntry.findMany({ where: { ...tenantScope(user), status: "ACTIVE", ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { title: true, body: true } });
  if (live.some((e) => norm(e.body) === norm(body) || norm(e.title) === norm(title))) {
    throw new ApiError(409, "There is already an active entry with this title or text. Edit that one instead.", "DUPLICATE");
  }
}

export async function createEntry(user: SessionUser, raw: z.input<typeof knowledgeInput>) {
  const input = knowledgeInput.parse(raw);
  if (await db.knowledgeEntry.findUnique({ where: { tenantId_key: { tenantId: user.tenantId, key: input.key } }, select: { id: true } })) {
    throw new ApiError(409, "An entry with this key already exists.", "DUPLICATE");
  }
  await assertNotDuplicate(user, input.title, input.body);
  return db.knowledgeEntry.create({
    data: {
      tenantId: user.tenantId, ...input, updatedById: user.id,
      versions: { create: { tenantId: user.tenantId, version: 1, title: input.title, body: input.body, status: "ACTIVE", editedById: user.id } },
    },
  });
}

export async function updateEntry(user: SessionUser, id: string, raw: z.input<typeof knowledgePatch>) {
  const patch = knowledgePatch.parse(raw);
  const current = await db.knowledgeEntry.findFirst({ where: { id, ...tenantScope(user) } });
  if (!current) throw new ApiError(404, "Entry not found", "NOT_FOUND");
  const next = { ...current, ...patch };
  if (next.status === "ACTIVE" && (patch.title !== undefined || patch.body !== undefined || current.status === "ARCHIVED")) await assertNotDuplicate(user, next.title, next.body, id);
  const version = current.version + 1;
  const data: Prisma.KnowledgeEntryUpdateInput = {
    ...patch, version, fromDefault: false, updatedById: user.id,
    versions: { create: { tenantId: user.tenantId, version, title: next.title, body: next.body, status: next.status, editedById: user.id } },
  };
  return db.knowledgeEntry.update({ where: { id: current.id, ...tenantScope(user) }, data });
}

/** Everything shipped for Ivycandy Hair: the returns policy and the product, care, shipping and wholesale FAQ. */
export const DEFAULT_KNOWLEDGE: readonly KnowledgeInput[] = [...DEFAULT_POLICY, ...DEFAULT_FAQ];

/**
 * Copies the shipped policy and FAQ in. New keys are created; entries still as shipped are refreshed if the shipped text changed;
 * entries an admin has edited are never touched. Safe to run again.
 */
export async function importDefaultPolicy(user: SessionUser, policy: readonly KnowledgeInput[] = DEFAULT_KNOWLEDGE) {
  const result = { created: 0, updated: 0, unchanged: 0, skippedEdited: 0 };
  for (const raw of policy) {
    const input = knowledgeInput.parse(raw);
    const existing = await db.knowledgeEntry.findUnique({ where: { tenantId_key: { tenantId: user.tenantId, key: input.key } } });
    if (!existing) {
      await db.knowledgeEntry.create({
        data: {
          tenantId: user.tenantId, ...input, fromDefault: true, updatedById: user.id,
          versions: { create: { tenantId: user.tenantId, version: 1, title: input.title, body: input.body, status: "ACTIVE", editedById: user.id } },
        },
      });
      result.created++;
    } else if (!existing.fromDefault) {
      result.skippedEdited++;
    } else if (existing.title === input.title && existing.body === input.body && existing.category === input.category && existing.basis === input.basis && existing.status === "ACTIVE") {
      result.unchanged++;
    } else {
      const version = existing.version + 1;
      await db.knowledgeEntry.update({
        where: { id: existing.id, ...tenantScope(user) },
        data: { ...input, status: "ACTIVE", version, updatedById: user.id, versions: { create: { tenantId: user.tenantId, version, title: input.title, body: input.body, status: "ACTIVE", editedById: user.id } } },
      });
      result.updated++;
    }
  }
  return result;
}
