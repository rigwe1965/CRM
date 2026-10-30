import type { AiProposal, AiProposalKind, AiProposalStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import type { SessionUser } from "@/lib/auth-helpers";
import { loadAssistantSettings } from "@/lib/ai/settings";
import { KINDS, nice, type Prepared, type Preview } from "@/lib/ai/proposal-kinds";
import { ToolError } from "@/lib/ai/tools/types";

/**
 * Proposals: what Ivy suggests and what the person decided (AI_ASSISTANT_PLAN.md, Phase 2). Saving a proposal writes
 * nothing to the business. A person's approval runs the real action, as them, through the same code as the screens, and
 * a proposal is decided exactly once: the claim below is a conditional update, so a double click cannot apply it twice.
 * Every lookup names the business and the person, so nobody can see or decide another's proposal.
 */

export const PROPOSAL_TTL_MS = 24 * 3_600_000;
/** Cards waiting on one chat, and on one person overall: a runaway loop cannot bury them in suggestions. */
export const MAX_PENDING_PER_CONVERSATION = 10;
export const MAX_PENDING_PER_USER = 30;

const DRAFT: AiProposalKind = "MESSAGE_DRAFT";

export type ProposalDto = {
  id: string;
  conversationId: string;
  kind: AiProposalKind;
  status: AiProposalStatus;
  preview: Preview;
  /** Drafts are copied, not approved. */
  approvable: boolean;
  /** Fields the person may change on the card before approving, with their current values. */
  editable: Record<string, string | null>;
  result: { href: string; entity: string } | null;
  failure: string | null;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
};

const EDITABLE: Record<AiProposalKind, string[]> = {
  TASK_CREATE: ["title", "dueDate", "priority"],
  TASK_CHANGE: ["title", "dueDate", "priority", "status"],
  NOTE_CREATE: ["subject", "body"],
  STAGE_CHANGE: ["stage", "lostReason"],
  MESSAGE_DRAFT: [],
  PAYMENT_RECORD: ["paidAt", "method", "reference", "note"],
  CONTACT_CREATE: ["firstName", "lastName", "email", "phone", "city", "country"],
  DEAL_CREATE: ["title", "expectedCloseDate"],
};

function editableValues(row: Pick<AiProposal, "kind" | "params">): Record<string, string | null> {
  const p = row.params as Record<string, unknown>;
  const source = row.kind === "TASK_CHANGE" ? { ...(p.changes as Record<string, unknown>) } : p;
  return Object.fromEntries(EDITABLE[row.kind].map((k) => [k, source[k] == null ? null : String(source[k])]));
}

export function toDto(row: AiProposal): ProposalDto {
  const result = row.status === "APPLIED" && row.resultEntity && row.resultId ? { entity: row.resultEntity, href: hrefFor(row) } : null;
  return {
    id: row.id,
    conversationId: row.conversationId,
    kind: row.kind,
    status: row.status,
    preview: row.preview as unknown as Preview,
    approvable: row.kind !== DRAFT,
    editable: row.status === "PENDING" ? editableValues(row) : {},
    result,
    failure: row.failure,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
  };
}

const hrefFor = (row: AiProposal) => {
  const p = row.params as Record<string, unknown>;
  if (row.resultEntity === "deal") return `/deals/${row.resultId}`;
  if (row.resultEntity === "contact") return `/contacts/${row.resultId}`;
  if (row.resultEntity === "activity") return p.contactId ? `/contacts/${p.contactId}` : `/deals/${p.dealId}`;
  return "/tasks";
};

/** Pending proposals past their time become EXPIRED. Cheap, so it runs before anything reads or decides them. */
export async function expireDue(tenantId: string, now = new Date()) {
  const { count } = await db.aiProposal.updateMany({ where: { tenantId, status: "PENDING", expiresAt: { lt: now } }, data: { status: "EXPIRED", decidedAt: now } });
  return count;
}

/**
 * Checks and saves a proposal made by Ivy's tool. `raw` is the model's input; `prepare` validates it against the
 * screens' own schemas and scope. Throws ToolError, in words the model can act on, when it should not be saved.
 */
export async function propose(ctx: { user: SessionUser; conversationId?: string; now: Date }, kind: AiProposalKind, raw: unknown): Promise<{ id: string; preview: Preview }> {
  const { user, conversationId, now } = ctx;
  if (!conversationId) throw new ToolError("Proposals are not available here.");
  const settings = await loadAssistantSettings(user.tenantId);
  if (settings.proposalsEnabled !== true) {
    throw new ToolError("Proposed actions are switched off for this business, so you cannot propose this. Tell the person an admin can allow them in Settings, under Ivy, and describe what they can do themselves instead.");
  }
  if (kind === "PAYMENT_RECORD" && settings.paymentProposalsEnabled !== true) {
    throw new ToolError("Payment proposals are switched off for this business, so you cannot propose recording a payment. Tell the person an admin can allow them in Settings, under Ivy, and that they can record it themselves on the deal's page.");
  }
  if (user.tenantWritable === false) throw new ToolError("This workspace is read-only until its subscription is renewed, so nothing can be changed. Say so plainly.");

  await expireDue(user.tenantId, now);
  const [inChat, mine] = await Promise.all([
    db.aiProposal.count({ where: { tenantId: user.tenantId, userId: user.id, conversationId, status: "PENDING" } }),
    db.aiProposal.count({ where: { tenantId: user.tenantId, userId: user.id, status: "PENDING" } }),
  ]);
  if (inChat >= MAX_PENDING_PER_CONVERSATION || mine >= MAX_PENDING_PER_USER) {
    throw new ToolError("There are already a lot of proposals waiting for the person to decide. Ask them to approve or decline some before you suggest more.");
  }

  const prepared: Prepared = await KINDS[kind].prepare(user, raw as never);
  const row = await db.aiProposal.create({
    data: {
      tenantId: user.tenantId,
      userId: user.id,
      conversationId,
      kind,
      params: prepared.params as Prisma.InputJsonValue,
      preview: prepared.preview as unknown as Prisma.InputJsonValue,
      expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS),
    },
  });
  return { id: row.id, preview: prepared.preview };
}

const mine = (user: { id: string; tenantId: string }) => ({ tenantId: user.tenantId, userId: user.id });

export async function listProposals(user: { id: string; tenantId: string }, conversationId: string) {
  await expireDue(user.tenantId);
  const rows = await db.aiProposal.findMany({ where: { ...mine(user), conversationId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 100 });
  return rows.map(toDto);
}

async function loadMine(user: { id: string; tenantId: string }, id: string) {
  const row = await db.aiProposal.findFirst({ where: { id, ...mine(user) } });
  if (!row) throw new ApiError(404, "That proposal was not found.", "NOT_FOUND");
  return row;
}

export async function declineProposal(user: { id: string; tenantId: string }, id: string) {
  await expireDue(user.tenantId);
  const now = new Date();
  const { count } = await db.aiProposal.updateMany({ where: { id, ...mine(user), status: "PENDING" }, data: { status: "DECLINED", decidedAt: now } });
  const row = await loadMine(user, id);
  if (count === 0) throw new ApiError(409, `This proposal was already ${row.status.toLowerCase()}.`, "AI_PROPOSAL_DECIDED");
  return toDto(row);
}

/**
 * Approves a proposal: claims it (once), re-validates what will be applied (with any edits the person made), runs the
 * action as them and records the result. If the record changed since Ivy suggested it, nothing is done and the card says why.
 */
export async function approveProposal(user: SessionUser, id: string, edits: unknown) {
  await expireDue(user.tenantId);
  const row = await loadMine(user, id);
  const kind = KINDS[row.kind];
  if (!kind.apply) throw new ApiError(422, "This is a draft to copy; there is nothing to approve.", "AI_PROPOSAL_NOT_APPROVABLE");
  if (row.status !== "PENDING") throw new ApiError(409, `This proposal was already ${row.status.toLowerCase()}.`, "AI_PROPOSAL_DECIDED");

  const parsed = kind.edit.safeParse(edits ?? {});
  if (!parsed.success) throw new ApiError(422, parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "), "VALIDATION_ERROR");
  const changed = parsed.data;
  const params = row.kind === "TASK_CHANGE" ? { ...(row.params as Record<string, unknown>), changes: { ...((row.params as { changes: object }).changes), ...changed } } : { ...(row.params as Record<string, unknown>), ...changed };

  const now = new Date();
  const claim = await db.aiProposal.updateMany({ where: { id, ...mine(user), status: "PENDING" }, data: { status: "APPLIED", decidedAt: now, params: params as Prisma.InputJsonValue } });
  if (claim.count === 0) throw new ApiError(409, "This proposal was just decided somewhere else.", "AI_PROPOSAL_DECIDED");

  try {
    const done = await kind.apply(user, params);
    return toDto(await db.aiProposal.update({ where: { id, tenantId: user.tenantId }, data: { resultEntity: done.entity, resultId: done.id } }));
  } catch (e) {
    const failure =
      e instanceof ApiError
        ? e.message
        : "Something went wrong. Check the record to see whether anything changed.";
    if (!(e instanceof ApiError)) console.error("[ivy] approved proposal failed", row.kind, e instanceof Error ? e.message : e);
    return toDto(await db.aiProposal.update({ where: { id, tenantId: user.tenantId }, data: { status: "FAILED", failure } }));
  }
}

/**
 * The note that goes in front of the person's next question, telling Ivy how its earlier proposals ended, so it never
 * assumes. Marks them as told. Returns null when there is nothing new.
 */
export async function takeOutcomes(user: { id: string; tenantId: string }, conversationId: string): Promise<string | null> {
  await expireDue(user.tenantId);
  const rows = await db.aiProposal.findMany({
    where: { ...mine(user), conversationId, reportedAt: null, status: { not: "PENDING" } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 20,
  });
  if (rows.length === 0) return null;
  await db.aiProposal.updateMany({ where: { id: { in: rows.map((r) => r.id) }, ...mine(user) }, data: { reportedAt: new Date() } });
  const lines = rows.map((r) => {
    const p = r.preview as unknown as Preview;
    const what = [p.title, ...p.lines.slice(0, 3).map((l) => `${l.label}: ${l.value}`)].join("; ");
    const how = r.status === "APPLIED" ? "approved and done" : r.status === "DECLINED" ? "declined, nothing was done" : r.status === "EXPIRED" ? "expired without a decision, nothing was done" : `approved but not done: ${r.failure ?? "it failed"}`;
    return `- ${nice(r.kind)} (${what}): ${how}`;
  });
  return ["<proposal_outcomes>", "How your earlier proposals ended. This note comes from the CRM, not from the person.", ...lines, "</proposal_outcomes>"].join("\n");
}
