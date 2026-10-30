import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { db, settings, taskCreate, taskChange, noteCreate, draft, paymentRecord, scheduleReplace } = vi.hoisted(() => ({
  scheduleReplace: { prepare: vi.fn(), apply: vi.fn(), edit: undefined as unknown },
  paymentRecord: { prepare: vi.fn(), apply: vi.fn(), edit: undefined as unknown },
  db: { aiProposal: { count: vi.fn(), create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn() } },
  settings: vi.fn(),
  taskCreate: { prepare: vi.fn(), apply: vi.fn(), edit: undefined as unknown },
  taskChange: { prepare: vi.fn(), apply: vi.fn(), edit: undefined as unknown },
  noteCreate: { prepare: vi.fn(), apply: vi.fn(), edit: undefined as unknown },
  draft: { prepare: vi.fn(), edit: undefined as unknown },
}));
taskCreate.edit = z.object({ title: z.string().min(1) }).partial();
taskChange.edit = z.object({ status: z.string() }).partial();
scheduleReplace.edit = z.object({});
paymentRecord.edit = z.object({ note: z.string() }).partial();
noteCreate.edit = z.object({ subject: z.string().min(1) }).partial();
draft.edit = z.object({});

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/ai/settings", () => ({ loadAssistantSettings: settings }));
vi.mock("@/lib/ai/proposal-kinds", () => ({
  KINDS: { SCHEDULE_REPLACE: scheduleReplace, PAYMENT_RECORD: paymentRecord, TASK_CREATE: taskCreate, TASK_CHANGE: taskChange, NOTE_CREATE: noteCreate, MESSAGE_DRAFT: draft },
  nice: (s: string) => s.toLowerCase(),
}));

import { ApiError } from "@/lib/api";
import { ToolError } from "@/lib/ai/tools/types";
import { Prisma } from "@prisma/client";
import { approveProposal, createBackgroundProposal, declineProposal, INBOX_TTL_MS, listInbox, listProposals, MAX_PENDING_PER_CONVERSATION, MAX_PENDING_PER_USER, propose, PROPOSAL_TTL_MS, takeOutcomes, toDto } from "@/lib/ai/proposals";

const user = { id: "u1", tenantId: "t1", role: "SALES", tenantWritable: true } as never;
const now = new Date("2026-10-30T12:00:00Z");
const preview = { title: "Create a task", lines: [{ label: "Task", value: "Call Ada" }] };

const row = (over: Record<string, unknown> = {}) => ({
  id: "p1", tenantId: "t1", userId: "u1", conversationId: "c1", kind: "TASK_CREATE", status: "PENDING", params: { title: "Call Ada", dueDate: null }, preview,
  resultEntity: null, resultId: null, failure: null, createdAt: now, expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS), decidedAt: null, reportedAt: null, ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  settings.mockResolvedValue({ enabled: true, monthlyCeilingUsd: 10, proposalsEnabled: true });
  db.aiProposal.updateMany.mockResolvedValue({ count: 0 });
  db.aiProposal.count.mockResolvedValue(0);
  taskCreate.prepare.mockResolvedValue({ params: { title: "Call Ada" }, preview });
});

describe("propose", () => {
  const ctx = { user, conversationId: "c1", now };

  it("saves what was checked, for this person, business and chat, to expire in 24 hours, and writes nothing else", async () => {
    db.aiProposal.create.mockResolvedValue({ id: "p9" });
    const out = await propose(ctx, "TASK_CREATE", { title: "x" });
    expect(out).toEqual({ id: "p9", preview });
    expect(taskCreate.prepare).toHaveBeenCalledWith(user, { title: "x" });
    expect(db.aiProposal.create.mock.calls[0][0].data).toEqual({ tenantId: "t1", userId: "u1", conversationId: "c1", kind: "TASK_CREATE", params: { title: "Call Ada" }, preview, expiresAt: new Date(now.getTime() + 24 * 3_600_000) });
    expect(taskCreate.apply).not.toHaveBeenCalled();
  });

  it("refuses, in words for the model, when the business has not allowed proposed actions", async () => {
    settings.mockResolvedValue({ enabled: true, monthlyCeilingUsd: 10 });
    await expect(propose(ctx, "TASK_CREATE", {})).rejects.toThrow(/switched off/);
    expect(db.aiProposal.create).not.toHaveBeenCalled();
    expect(taskCreate.prepare).not.toHaveBeenCalled();
  });

  it("refuses a payment unless the admin allowed payment proposals too, even with proposed actions on", async () => {
    taskCreate.prepare.mockClear();
    paymentRecord.prepare.mockResolvedValue({ params: { dealId: "d1" }, preview });
    await expect(propose(ctx, "PAYMENT_RECORD", { dealId: "d1", amount: 5 })).rejects.toThrow(/Payment proposals .*switched off/);
    expect(paymentRecord.prepare).not.toHaveBeenCalled();
    expect(db.aiProposal.create).not.toHaveBeenCalled();
    settings.mockResolvedValue({ enabled: true, monthlyCeilingUsd: 10, proposalsEnabled: true, paymentProposalsEnabled: true });
    db.aiProposal.create.mockResolvedValue({ id: "p5" });
    expect((await propose(ctx, "PAYMENT_RECORD", { dealId: "d1", amount: 5 })).id).toBe("p5");
  });

  it("treats an instalment schedule like a payment: it needs the payment switch too", async () => {
    scheduleReplace.prepare.mockResolvedValue({ params: { dealId: "d1" }, preview });
    await expect(propose(ctx, "SCHEDULE_REPLACE", { dealId: "d1" })).rejects.toThrow(/Payment proposals \(which include instalment schedules\) are switched off/);
    expect(scheduleReplace.prepare).not.toHaveBeenCalled();
    settings.mockResolvedValue({ enabled: true, monthlyCeilingUsd: 10, proposalsEnabled: true, paymentProposalsEnabled: true });
    db.aiProposal.create.mockResolvedValue({ id: "p6" });
    expect((await propose(ctx, "SCHEDULE_REPLACE", { dealId: "d1" })).id).toBe("p6");
  });

  it("refuses in a read-only workspace", async () => {
    await expect(propose({ ...ctx, user: { ...(user as object), tenantWritable: false } as never }, "TASK_CREATE", {})).rejects.toThrow(/read-only/);
    expect(db.aiProposal.create).not.toHaveBeenCalled();
  });

  it("needs a chat to attach the card to", async () => {
    await expect(propose({ user, now }, "TASK_CREATE", {})).rejects.toBeInstanceOf(ToolError);
  });

  it("stops piling up cards: ten waiting in a chat, thirty for a person", async () => {
    db.aiProposal.count.mockResolvedValueOnce(MAX_PENDING_PER_CONVERSATION).mockResolvedValueOnce(0);
    await expect(propose(ctx, "TASK_CREATE", {})).rejects.toThrow(/lot of proposals waiting/);
    db.aiProposal.count.mockResolvedValueOnce(0).mockResolvedValueOnce(MAX_PENDING_PER_USER);
    await expect(propose(ctx, "TASK_CREATE", {})).rejects.toThrow(/lot of proposals waiting/);
    expect(db.aiProposal.create).not.toHaveBeenCalled();
  });

  it("counts only this person's pending cards, in this business", async () => {
    db.aiProposal.create.mockResolvedValue({ id: "p9" });
    await propose(ctx, "TASK_CREATE", {});
    expect(db.aiProposal.count.mock.calls[0][0].where).toEqual({ tenantId: "t1", userId: "u1", conversationId: "c1", status: "PENDING" });
    expect(db.aiProposal.count.mock.calls[1][0].where).toEqual({ tenantId: "t1", userId: "u1", status: "PENDING" });
  });

  it("passes on what the kind refuses (an invisible record, a bad date) without saving", async () => {
    taskCreate.prepare.mockRejectedValue(new ToolError("No contact with that id is visible to you."));
    await expect(propose(ctx, "TASK_CREATE", {})).rejects.toThrow(/No contact/);
    expect(db.aiProposal.create).not.toHaveBeenCalled();
  });
});

describe("createBackgroundProposal", () => {
  const input = { kind: "TASK_CREATE" as const, raw: { title: "x" }, source: "DAILY" as const, dedupeKey: "inst:d1:2026-W44:task", reason: "Overdue for 5 days", subject: { type: "deal", id: "d1" }, now };

  it("saves a suggestion that belongs to no chat, for three days, with its reason, source and dedupe key", async () => {
    db.aiProposal.create.mockResolvedValue({ id: "p7" });
    const out = await createBackgroundProposal(user, input);
    expect(out).toEqual({ id: "p7", preview });
    expect(taskCreate.prepare).toHaveBeenCalledWith(user, { title: "x" });
    expect(db.aiProposal.create.mock.calls[0][0].data).toEqual({
      tenantId: "t1", userId: "u1", conversationId: null, source: "DAILY", dedupeKey: "inst:d1:2026-W44:task", reason: "Overdue for 5 days", subjectType: "deal", subjectId: "d1",
      kind: "TASK_CREATE", params: { title: "Call Ada" }, preview, expiresAt: new Date(now.getTime() + INBOX_TTL_MS),
    });
    expect(INBOX_TTL_MS).toBe(3 * 86_400_000);
  });

  it("does not need the chat switches: it is the inbox's own switch that gates it, upstream", async () => {
    settings.mockResolvedValue({ enabled: true, monthlyCeilingUsd: 10 });
    db.aiProposal.create.mockResolvedValue({ id: "p7" });
    await expect(createBackgroundProposal(user, input)).resolves.toBeTruthy();
  });

  it("adds a warning to the card when asked, without losing the card's own", async () => {
    taskCreate.prepare.mockResolvedValue({ params: {}, preview: { ...preview, warning: "A payment was already recorded." } });
    db.aiProposal.create.mockResolvedValue({ id: "p7" });
    const out = await createBackgroundProposal(user, { ...input, extraWarning: "Contains a link." });
    expect(out!.preview.warning).toBe("A payment was already recorded. Contains a link.");
    expect(db.aiProposal.create.mock.calls[0][0].data.preview.warning).toBe("A payment was already recorded. Contains a link.");
  });

  it("returns null, writing nothing new, when that suggestion was already made (the unique dedupe key)", async () => {
    db.aiProposal.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }));
    expect(await createBackgroundProposal(user, input)).toBeNull();
  });

  it("lets other database errors through, and what the kind refuses (an invisible record)", async () => {
    db.aiProposal.create.mockRejectedValue(new Error("connection lost"));
    await expect(createBackgroundProposal(user, input)).rejects.toThrow("connection lost");
    taskCreate.prepare.mockRejectedValue(new ToolError("No deal with that id is visible to you."));
    await expect(createBackgroundProposal(user, input)).rejects.toBeInstanceOf(ToolError);
  });
});

describe("listInbox", () => {
  it("lists this person's own daily and WhatsApp suggestions that are waiting, or were decided in the last day", async () => {
    db.aiProposal.findMany.mockResolvedValue([row({ source: "DAILY", reason: "Why", conversationId: null })]);
    const out = await listInbox({ id: "u1", tenantId: "t1" }, now);
    const where = db.aiProposal.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ tenantId: "t1", userId: "u1", source: { in: ["DAILY", "WHATSAPP"] } });
    expect(where.OR).toEqual([{ status: "PENDING" }, { decidedAt: { gte: new Date(now.getTime() - 86_400_000) } }]);
    expect(out[0]).toMatchObject({ source: "DAILY", reason: "Why", conversationId: null });
    expect(db.aiProposal.updateMany.mock.calls[0][0]).toMatchObject({ where: { tenantId: "t1", status: "PENDING" }, data: { status: "EXPIRED" } });
  });
});

describe("listProposals", () => {
  it("lists only this person's cards in the chat, and closes the ones that ran out of time first", async () => {
    db.aiProposal.findMany.mockResolvedValue([row()]);
    const out = await listProposals({ id: "u1", tenantId: "t1" }, "c1");
    expect(db.aiProposal.updateMany.mock.calls[0][0]).toMatchObject({ where: { tenantId: "t1", status: "PENDING" }, data: { status: "EXPIRED" } });
    expect(db.aiProposal.findMany.mock.calls[0][0].where).toEqual({ tenantId: "t1", userId: "u1", conversationId: "c1" });
    expect(out[0]).toMatchObject({ id: "p1", status: "PENDING", approvable: true, editable: { title: "Call Ada", dueDate: null, priority: null } });
  });
});

describe("toDto", () => {
  it("offers no edits once decided, links to what was made, and marks drafts as not approvable", () => {
    expect(toDto(row({ status: "APPLIED", resultEntity: "task", resultId: "t9" }) as never)).toMatchObject({ editable: {}, result: { href: "/tasks", entity: "task" }, approvable: true });
    expect(toDto(row({ kind: "STAGE_CHANGE", status: "APPLIED", resultEntity: "deal", resultId: "d1", params: {} }) as never).result?.href).toBe("/deals/d1");
    expect(toDto(row({ kind: "NOTE_CREATE", status: "APPLIED", resultEntity: "activity", resultId: "a1", params: { contactId: "c7" } }) as never).result?.href).toBe("/contacts/c7");
    expect(toDto(row({ kind: "MESSAGE_DRAFT", params: {} }) as never).approvable).toBe(false);
  });

  it("shows the editable fields of the new kinds, and links to the contact or deal they made", () => {
    expect(toDto(row({ kind: "PAYMENT_RECORD", params: { paidAt: "2026-10-30", method: "CASH", reference: null, note: null } }) as never).editable).toEqual({ paidAt: "2026-10-30", method: "CASH", reference: null, note: null });
    expect(toDto(row({ kind: "DEAL_CREATE", params: { title: "Order", expectedCloseDate: null } }) as never).editable).toEqual({ title: "Order", expectedCloseDate: null });
    expect(toDto(row({ kind: "CONTACT_CREATE", status: "APPLIED", resultEntity: "contact", resultId: "c4", params: { firstName: "A", lastName: "B" } }) as never).result?.href).toBe("/contacts/c4");
  });

  it("shows the changes of a task change as the editable values", () => {
    expect(toDto(row({ kind: "TASK_CHANGE", params: { taskId: "t1", changes: { status: "DONE" }, expect: { status: "TODO" } } }) as never).editable).toEqual({ title: null, dueDate: null, priority: null, status: "DONE" });
  });
});

describe("declineProposal", () => {
  it("declines a waiting proposal of the person's own, once", async () => {
    db.aiProposal.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    db.aiProposal.findFirst.mockResolvedValue(row({ status: "DECLINED" }));
    const out = await declineProposal({ id: "u1", tenantId: "t1" }, "p1");
    expect(out.status).toBe("DECLINED");
    expect(db.aiProposal.updateMany.mock.calls[1][0].where).toEqual({ id: "p1", tenantId: "t1", userId: "u1", status: "PENDING" });
  });

  it("says so when it was already decided, and 404s on someone else's", async () => {
    db.aiProposal.updateMany.mockResolvedValue({ count: 0 });
    db.aiProposal.findFirst.mockResolvedValueOnce(row({ status: "APPLIED" }));
    await expect(declineProposal({ id: "u1", tenantId: "t1" }, "p1")).rejects.toMatchObject({ status: 409, code: "AI_PROPOSAL_DECIDED" });
    db.aiProposal.findFirst.mockResolvedValueOnce(null);
    await expect(declineProposal({ id: "u1", tenantId: "t1" }, "other")).rejects.toMatchObject({ status: 404 });
    expect(db.aiProposal.findFirst.mock.calls[1][0].where).toEqual({ id: "other", tenantId: "t1", userId: "u1" });
  });
});

describe("approveProposal", () => {
  const claim = () => db.aiProposal.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });

  it("claims it once, then runs the action as the person and records what it made", async () => {
    db.aiProposal.findFirst.mockResolvedValue(row());
    claim();
    taskCreate.apply.mockResolvedValue({ entity: "task", id: "t9", href: "/tasks" });
    db.aiProposal.update.mockImplementation(async (a: { data: object }) => row({ status: "APPLIED", ...a.data }));
    const out = await approveProposal(user, "p1", {});
    expect(db.aiProposal.updateMany.mock.calls[1][0]).toMatchObject({ where: { id: "p1", tenantId: "t1", userId: "u1", status: "PENDING" }, data: { status: "APPLIED" } });
    expect(taskCreate.apply).toHaveBeenCalledWith(user, { title: "Call Ada", dueDate: null });
    expect(db.aiProposal.update.mock.calls[0][0]).toEqual({ where: { id: "p1", tenantId: "t1" }, data: { resultEntity: "task", resultId: "t9" } });
    expect(out).toMatchObject({ status: "APPLIED", result: { entity: "task" } });
  });

  it("applies the person's edits, and saves what was applied", async () => {
    db.aiProposal.findFirst.mockResolvedValue(row());
    claim();
    taskCreate.apply.mockResolvedValue({ entity: "task", id: "t9", href: "/tasks" });
    db.aiProposal.update.mockResolvedValue(row({ status: "APPLIED" }));
    await approveProposal(user, "p1", { title: "Call Ada before noon" });
    expect(taskCreate.apply).toHaveBeenCalledWith(user, { title: "Call Ada before noon", dueDate: null });
    expect(db.aiProposal.updateMany.mock.calls[1][0].data.params).toEqual({ title: "Call Ada before noon", dueDate: null });
  });

  it("merges the edits of a task change into its changes, keeping what the task was expected to be", async () => {
    db.aiProposal.findFirst.mockResolvedValue(row({ kind: "TASK_CHANGE", params: { taskId: "t1", changes: { status: "DONE" }, expect: { status: "TODO" } } }));
    claim();
    taskChange.apply.mockResolvedValue({ entity: "task", id: "t1", href: "/tasks" });
    db.aiProposal.update.mockResolvedValue(row({ status: "APPLIED" }));
    await approveProposal(user, "p1", { status: "CANCELLED" });
    expect(taskChange.apply).toHaveBeenCalledWith(user, { taskId: "t1", changes: { status: "CANCELLED" }, expect: { status: "TODO" } });
  });

  it("refuses an edit to a field the card does not offer", async () => {
    db.aiProposal.findFirst.mockResolvedValue(row());
    await expect(approveProposal(user, "p1", { title: "" })).rejects.toMatchObject({ status: 422 });
    expect(taskCreate.apply).not.toHaveBeenCalled();
  });

  it("does nothing for a draft, a decided proposal, or one that ran out of time", async () => {
    db.aiProposal.findFirst.mockResolvedValueOnce(row({ kind: "MESSAGE_DRAFT" }));
    await expect(approveProposal(user, "p1", {})).rejects.toMatchObject({ status: 422, code: "AI_PROPOSAL_NOT_APPROVABLE" });
    db.aiProposal.findFirst.mockResolvedValueOnce(row({ status: "APPLIED" }));
    await expect(approveProposal(user, "p1", {})).rejects.toMatchObject({ status: 409, code: "AI_PROPOSAL_DECIDED" });
    db.aiProposal.findFirst.mockResolvedValueOnce(row({ status: "EXPIRED" }));
    await expect(approveProposal(user, "p1", {})).rejects.toMatchObject({ status: 409 });
    expect(taskCreate.apply).not.toHaveBeenCalled();
  });

  it("applies nothing when a second click loses the claim", async () => {
    db.aiProposal.findFirst.mockResolvedValue(row());
    db.aiProposal.updateMany.mockResolvedValue({ count: 0 });
    await expect(approveProposal(user, "p1", {})).rejects.toMatchObject({ status: 409 });
    expect(taskCreate.apply).not.toHaveBeenCalled();
  });

  it("404s on another person's proposal, without touching it", async () => {
    db.aiProposal.findFirst.mockResolvedValue(null);
    await expect(approveProposal(user, "theirs", {})).rejects.toMatchObject({ status: 404 });
    expect(db.aiProposal.findFirst.mock.calls[0][0].where).toEqual({ id: "theirs", tenantId: "t1", userId: "u1" });
    expect(taskCreate.apply).not.toHaveBeenCalled();
  });

  it("records why when the record changed, in the person's words, and says nothing was done", async () => {
    db.aiProposal.findFirst.mockResolvedValue(row());
    claim();
    taskCreate.apply.mockRejectedValue(new ApiError(409, "The task is now Done, so nothing was changed.", "AI_PROPOSAL_STALE"));
    db.aiProposal.update.mockImplementation(async (a: { data: object }) => row({ ...a.data }));
    const out = await approveProposal(user, "p1", {});
    expect(db.aiProposal.update.mock.calls[0][0].data).toEqual({ status: "FAILED", failure: "The task is now Done, so nothing was changed." });
    expect(out).toMatchObject({ status: "FAILED", failure: "The task is now Done, so nothing was changed." });
  });

  it("hides an unexpected error's details, and logs it", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.aiProposal.findFirst.mockResolvedValue(row());
    claim();
    taskCreate.apply.mockRejectedValue(new Error("duplicate key value violates constraint secret_table"));
    db.aiProposal.update.mockImplementation(async (a: { data: object }) => row({ ...a.data }));
    const out = await approveProposal(user, "p1", {});
    expect(out.failure).toMatch(/check the record/i);
    expect(JSON.stringify(out)).not.toContain("secret_table");
    spy.mockRestore();
  });
});

describe("takeOutcomes", () => {
  const who = { id: "u1", tenantId: "t1" };

  it("returns null when nothing new has been decided", async () => {
    db.aiProposal.findMany.mockResolvedValue([]);
    expect(await takeOutcomes(who, "c1")).toBeNull();
    expect(db.aiProposal.findMany.mock.calls[0][0].where).toEqual({ tenantId: "t1", userId: "u1", conversationId: "c1", reportedAt: null, status: { not: "PENDING" } });
  });

  it("tells Ivy how each ended, marks them told, and says the note is from the CRM", async () => {
    db.aiProposal.findMany.mockResolvedValue([
      row({ id: "a", status: "APPLIED" }),
      row({ id: "b", status: "DECLINED" }),
      row({ id: "c", status: "FAILED", failure: "The task is now Done." }),
      row({ id: "d", status: "EXPIRED" }),
    ]);
    const text = (await takeOutcomes(who, "c1"))!;
    expect(text.startsWith("<proposal_outcomes>")).toBe(true);
    expect(text).toContain("not from the person");
    expect(text).toContain("approved and done");
    expect(text).toContain("declined, nothing was done");
    expect(text).toContain("approved but not done: The task is now Done.");
    expect(text).toContain("expired without a decision");
    expect(db.aiProposal.updateMany.mock.calls.at(-1)![0]).toMatchObject({ where: { id: { in: ["a", "b", "c", "d"] }, tenantId: "t1", userId: "u1" }, data: { reportedAt: expect.any(Date) } });
  });
});
