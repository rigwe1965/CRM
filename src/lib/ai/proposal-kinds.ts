import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import type { SessionUser } from "@/lib/auth-helpers";
import { assertLinks, ownerScope, resolveOwner, taskScope, tenantScope } from "@/lib/access";
import { changeDealStage, createTask, logActivity, updateTask } from "@/lib/crm-actions";
import { createActivitySchema, createTaskSchema, dealStageSchema, updateTaskSchema } from "@/lib/validations/crm";
import { ToolError } from "@/lib/ai/tools/types";
import { fullName } from "@/lib/ai/tools/result";

/**
 * What Ivy can propose (AI_ASSISTANT_PLAN.md, Phase 2). For each kind: `input` is what the model may send, `prepare`
 * checks it against the same schemas and scope the screens use and builds the card text from the checked values
 * (never from the model's own wording), and `apply` runs the real action as the signed-in person when they approve.
 * Nothing here runs without a person's approval except `prepare`, which only reads.
 */

export type PreviewLine = { label: string; value: string };
/** What the card shows. Built by the server from the saved values. `draft` is a message to copy, never sent by us. */
export type Preview = { title: string; lines: PreviewLine[]; warning?: string; draft?: { text: string } };
export type Prepared = { params: Record<string, unknown>; preview: Preview };
export type Applied = { entity: string; id: string; href: string };

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-05");
const id = z.string().trim().min(1).max(40);
const priority = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);
const taskStatus = z.enum(["TODO", "IN_PROGRESS", "DONE", "CANCELLED"]);
const stage = z.enum(["QUALIFICATION", "DISCOVERY", "PROPOSAL", "NEGOTIATION", "CLOSED_WON", "CLOSED_LOST"]);

export const nice = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
const line = (label: string, value: string | null | undefined): PreviewLine[] => (value ? [{ label, value }] : []);

/** Problems with what the model sent go back to it in words, so it can correct itself or ask the person. */
function parseOrTell<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new ToolError(r.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
  return r.data;
}

async function visible<T>(check: () => Promise<T>): Promise<T> {
  try {
    return await check();
  } catch (e) {
    // "You can only assign records to yourself", "Contact not found": the model may correct itself, the person is unaffected.
    if (e instanceof ApiError) throw new ToolError(e.message);
    throw e;
  }
}

const contactName = async (user: SessionUser, contactId: string | null | undefined) => {
  if (!contactId) return null;
  const c = await db.contact.findFirst({ where: { id: contactId, deletedAt: null, ...ownerScope(user) }, select: { firstName: true, lastName: true } });
  return fullName(c);
};
const dealTitle = async (user: SessionUser, dealId: string | null | undefined) => {
  if (!dealId) return null;
  return (await db.deal.findFirst({ where: { id: dealId, deletedAt: null, ...ownerScope(user) }, select: { title: true } }))?.title ?? null;
};

// ─── Create a task ──────────────────────────────────────

export const taskCreateInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  dueDate: date.optional().describe("YYYY-MM-DD"),
  priority: priority.optional(),
  contactId: id.optional().describe("From find_contacts."),
  dealId: id.optional().describe("From find_deals."),
  assigneeId: id.optional().describe("Only admins can give a task to someone else; leave out to assign it to the person asking."),
});

const taskCreate = {
  edit: z.object({ title: z.string().trim().min(1).max(200), dueDate: date.nullable(), priority }).partial(),
  async prepare(user: SessionUser, raw: z.infer<typeof taskCreateInput>): Promise<Prepared> {
    const body = parseOrTell(createTaskSchema, { ...raw, status: "TODO" });
    await visible(() => assertLinks(user, body));
    const assigneeId = raw.assigneeId ? await visible(() => resolveOwner(user, raw.assigneeId)) : null;
    const assignee = assigneeId ? await db.user.findFirst({ where: { id: assigneeId, ...tenantScope(user) }, select: { name: true } }) : null;
    const params = { title: body.title, description: body.description ?? null, priority: body.priority, dueDate: raw.dueDate ?? null, contactId: body.contactId ?? null, dealId: body.dealId ?? null, assigneeId };
    return {
      params,
      preview: {
        title: "Create a task",
        lines: [
          ...line("Task", body.title), ...line("Due", raw.dueDate), ...line("Priority", nice(body.priority)), ...line("About", await contactName(user, body.contactId)),
          ...line("Deal", await dealTitle(user, body.dealId)), ...line("Assigned to", assignee?.name ?? (assigneeId && assigneeId !== user.id ? "Another team member" : "You")), ...line("Notes", body.description),
        ],
      },
    };
  },
  async apply(user: SessionUser, p: Record<string, unknown>): Promise<Applied> {
    const body = parseOrTell(createTaskSchema, { ...p, status: "TODO", assigneeId: p.assigneeId ?? undefined });
    const task = await createTask(user, body);
    return { entity: "task", id: task.id, href: "/tasks" };
  },
};

// ─── Change a task ──────────────────────────────────────

export const taskChangeInput = z.object({
  taskId: id.describe("From list_tasks."),
  status: taskStatus.optional(),
  dueDate: date.optional().describe("YYYY-MM-DD"),
  priority: priority.optional(),
  title: z.string().trim().min(1).max(200).optional(),
});

const taskChange = {
  edit: z.object({ title: z.string().trim().min(1).max(200), dueDate: date, priority, status: taskStatus }).partial(),
  async prepare(user: SessionUser, raw: z.infer<typeof taskChangeInput>): Promise<Prepared> {
    const { taskId, ...changes } = raw;
    if (Object.values(changes).every((v) => v === undefined)) throw new ToolError("Say what should change: status, dueDate, priority or title.");
    parseOrTell(updateTaskSchema, changes);
    const t = await db.task.findFirst({ where: { AND: [{ id: taskId }, taskScope(user)] }, select: { title: true, status: true, priority: true, dueDate: true } });
    if (!t) throw new ToolError("No task with that id is visible to you. Use list_tasks to find it.");
    const was = { status: t.status, priority: t.priority, dueDate: t.dueDate?.toISOString().slice(0, 10) ?? null, title: t.title };
    const diff = (Object.keys(changes) as (keyof typeof changes)[]).filter((k) => changes[k] !== undefined && changes[k] !== was[k]);
    if (diff.length === 0) throw new ToolError("The task already looks like that, so there is nothing to change.");
    const lines: PreviewLine[] = [{ label: "Task", value: t.title }];
    if (changes.status && changes.status !== was.status) lines.push({ label: "Status", value: `${nice(was.status)} → ${nice(changes.status)}` });
    if (changes.dueDate && changes.dueDate !== was.dueDate) lines.push({ label: "Due", value: `${was.dueDate ?? "no date"} → ${changes.dueDate}` });
    if (changes.priority && changes.priority !== was.priority) lines.push({ label: "Priority", value: `${nice(was.priority)} → ${nice(changes.priority)}` });
    if (changes.title && changes.title !== was.title) lines.push({ label: "New title", value: changes.title });
    return { params: { taskId, changes: Object.fromEntries(diff.map((k) => [k, changes[k]])), expect: { status: was.status } }, preview: { title: "Change a task", lines } };
  },
  async apply(user: SessionUser, p: Record<string, unknown>): Promise<Applied> {
    const { taskId, changes, expect } = p as { taskId: string; changes: Record<string, unknown>; expect: { status: string } };
    const body = parseOrTell(updateTaskSchema, changes);
    const now = await db.task.findFirst({ where: { AND: [{ id: taskId }, taskScope(user)] }, select: { status: true } });
    if (!now) throw new ApiError(404, "That task no longer exists, so nothing was changed.", "NOT_FOUND");
    if (now.status !== expect.status) throw new ApiError(409, `The task is now ${nice(now.status)} (it was ${nice(expect.status)} when Ivy suggested this), so nothing was changed.`, "AI_PROPOSAL_STALE");
    const task = await updateTask(user, taskId, body);
    return { entity: "task", id: task.id, href: "/tasks" };
  },
};

// ─── Log a note ─────────────────────────────────────────

export const noteCreateInput = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().max(2000).optional(),
  type: z.enum(["NOTE", "CALL", "EMAIL", "MEETING"]).optional().describe("Defaults to NOTE. This only records it; nothing is sent."),
  contactId: id.optional().describe("From find_contacts."),
  dealId: id.optional().describe("From find_deals."),
});

const noteCreate = {
  edit: z.object({ subject: z.string().trim().min(1).max(200), body: z.string().trim().max(2000) }).partial(),
  async prepare(user: SessionUser, raw: z.infer<typeof noteCreateInput>): Promise<Prepared> {
    if (!raw.contactId && !raw.dealId) throw new ToolError("Which contact or deal is this note about? Ask the person, or look it up first.");
    const body = parseOrTell(createActivitySchema, raw);
    await visible(() => assertLinks(user, body));
    const [who, deal] = await Promise.all([contactName(user, body.contactId), dealTitle(user, body.dealId)]);
    return {
      params: { type: body.type, subject: body.subject, body: body.body ?? null, contactId: body.contactId ?? null, dealId: body.dealId ?? null },
      preview: { title: `Log a ${body.type.toLowerCase()}`, lines: [...line("Subject", body.subject), ...line("Details", body.body), ...line("About", who), ...line("Deal", deal)] },
    };
  },
  async apply(user: SessionUser, p: Record<string, unknown>): Promise<Applied> {
    const body = parseOrTell(createActivitySchema, p);
    const a = await logActivity(user, body);
    return { entity: "activity", id: a.id, href: body.contactId ? `/contacts/${body.contactId}` : `/deals/${body.dealId}` };
  },
};

// ─── Change a deal's stage ──────────────────────────────

export const stageChangeInput = z.object({
  dealId: id.describe("From find_deals."),
  stage,
  lostReason: z.string().trim().max(500).optional().describe("Only for CLOSED_LOST."),
});

const stageChange = {
  edit: z.object({ stage, lostReason: z.string().trim().max(500) }).partial(),
  async prepare(user: SessionUser, raw: z.infer<typeof stageChangeInput>): Promise<Prepared> {
    const body = parseOrTell(dealStageSchema, { stage: raw.stage, lostReason: raw.lostReason });
    const d = await db.deal.findFirst({ where: { id: raw.dealId, deletedAt: null, ...ownerScope(user) }, select: { title: true, stage: true, currency: true, contact: { select: { firstName: true, lastName: true } } } });
    if (!d) throw new ToolError("No deal with that id is visible to you. Use find_deals to find it.");
    if (d.stage === body.stage) throw new ToolError(`The deal is already in ${nice(d.stage)}.`);
    const closing = body.stage === "CLOSED_WON" || body.stage === "CLOSED_LOST";
    const reopening = (d.stage === "CLOSED_WON" || d.stage === "CLOSED_LOST") && !closing;
    const warning = closing
      ? `This closes the deal as ${body.stage === "CLOSED_WON" ? "won (100%)" : "lost (0%)"}. Stage notifications and automations run, the same as moving it on the Deals page.`
      : reopening ? "This reopens a closed deal and clears its close date." : undefined;
    return {
      params: { dealId: raw.dealId, stage: body.stage, lostReason: body.lostReason ?? null, fromStage: d.stage },
      preview: { title: "Move a deal to another stage", lines: [...line("Deal", d.title), ...line("Customer", fullName(d.contact)), { label: "Stage", value: `${nice(d.stage)} → ${nice(body.stage)}` }, ...line("Reason", body.lostReason)], warning },
    };
  },
  async apply(user: SessionUser, p: Record<string, unknown>): Promise<Applied> {
    const { dealId, fromStage, ...rest } = p as { dealId: string; fromStage: string; stage: string; lostReason: string | null };
    const body = parseOrTell(dealStageSchema, { stage: rest.stage, lostReason: rest.lostReason ?? undefined });
    const now = await db.deal.findFirst({ where: { id: dealId, deletedAt: null, ...ownerScope(user) }, select: { stage: true } });
    if (!now) throw new ApiError(404, "That deal no longer exists, so nothing was changed.", "NOT_FOUND");
    if (now.stage !== fromStage) throw new ApiError(409, `The deal is now in ${nice(now.stage)} (it was in ${nice(fromStage)} when Ivy suggested this), so nothing was changed.`, "AI_PROPOSAL_STALE");
    await changeDealStage(user, dealId, body);
    return { entity: "deal", id: dealId, href: `/deals/${dealId}` };
  },
};

// ─── Draft a message (never sent) ───────────────────────

export const messageDraftInput = z.object({
  contactId: id.describe("From find_contacts."),
  channel: z.enum(["WHATSAPP", "EMAIL"]),
  subject: z.string().trim().max(200).optional().describe("Email only."),
  message: z.string().trim().min(1).max(4000),
});

const messageDraft = {
  edit: z.object({}),
  async prepare(user: SessionUser, raw: z.infer<typeof messageDraftInput>): Promise<Prepared> {
    const c = await db.contact.findFirst({
      where: { id: raw.contactId, deletedAt: null, ...ownerScope(user) },
      select: { firstName: true, lastName: true, emailOptOut: true, whatsappOptIn: true },
    });
    if (!c) throw new ToolError("No contact with that id is visible to you. Use find_contacts to find them.");
    const warning = raw.channel === "EMAIL" && c.emailOptOut ? "This contact has opted out of email." : raw.channel === "WHATSAPP" && !c.whatsappOptIn ? "This contact has not opted in to WhatsApp." : undefined;
    const text = raw.message;
    return {
      params: { contactId: raw.contactId, channel: raw.channel, subject: raw.subject ?? null, message: text },
      preview: {
        title: `Draft ${raw.channel === "EMAIL" ? "email" : "WhatsApp message"}`,
        lines: [...line("To", fullName(c)), ...(raw.channel === "EMAIL" ? line("Subject", raw.subject) : [])],
        warning,
        draft: { text },
      },
    };
  },
};

export type KindDef = {
  /** What a person may change on the card before approving; checked again on approval. */
  edit: z.ZodType<Record<string, unknown>>;
  prepare: (user: SessionUser, raw: never) => Promise<Prepared>;
  /** Absent for drafts: nothing is done, the person copies the text. */
  apply?: (user: SessionUser, params: Record<string, unknown>) => Promise<Applied>;
};

export const KINDS = {
  TASK_CREATE: taskCreate,
  TASK_CHANGE: taskChange,
  NOTE_CREATE: noteCreate,
  STAGE_CHANGE: stageChange,
  MESSAGE_DRAFT: messageDraft,
} as unknown as Record<"TASK_CREATE" | "TASK_CHANGE" | "NOTE_CREATE" | "STAGE_CHANGE" | "MESSAGE_DRAFT", KindDef>;
