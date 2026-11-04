import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, actions } = vi.hoisted(() => ({
  db: {
    contact: { findFirst: vi.fn() },
    organization: { findFirst: vi.fn() },
    deal: { findFirst: vi.fn() },
    task: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
  },
  actions: { createTask: vi.fn(), updateTask: vi.fn(), logActivity: vi.fn(), changeDealStage: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/crm-actions", () => actions);

import { ApiError } from "@/lib/api";
import { ToolError } from "@/lib/ai/tools/types";
import { KINDS } from "@/lib/ai/proposal-kinds";

const sales = { id: "u-sales", tenantId: "t1", role: "SALES", name: "Sam" } as never;
const admin = { id: "u-admin", tenantId: "t1", role: "ADMIN", name: "Ada" } as never;
const prepare = (kind: keyof typeof KINDS, user: never, raw: unknown) => (KINDS[kind].prepare as unknown as (u: never, r: unknown) => Promise<{ params: Record<string, unknown>; preview: { title: string; lines: { label: string; value: string }[]; warning?: string; draft?: { text: string } } }>)(user, raw);

beforeEach(() => {
  vi.resetAllMocks();
  db.contact.findFirst.mockResolvedValue({ firstName: "Adaeze", lastName: "Okafor", emailOptOut: false, whatsappOptIn: true });
  db.deal.findFirst.mockResolvedValue({ title: "Luxe Lace order", stage: "DISCOVERY", contact: { firstName: "Adaeze", lastName: "Okafor" } });
  db.user.findFirst.mockResolvedValue({ id: "u-sam", name: "Sam" });
});

describe("TASK_CREATE", () => {
  it("builds the card from the checked values, looking names up through the person's own scope", async () => {
    const out = await prepare("TASK_CREATE", sales, { title: " Call Ada ", dueDate: "2026-11-05", priority: "HIGH", contactId: "c1", dealId: "d1" });
    expect(out.params).toEqual({ title: "Call Ada", description: null, priority: "HIGH", dueDate: "2026-11-05", contactId: "c1", dealId: "d1", assigneeId: null });
    expect(out.preview.lines).toEqual([
      { label: "Task", value: "Call Ada" }, { label: "Due", value: "2026-11-05" }, { label: "Priority", value: "High" }, { label: "About", value: "Adaeze Okafor" },
      { label: "Deal", value: "Luxe Lace order" }, { label: "Assigned to", value: "You" },
    ]);
    for (const call of [...db.contact.findFirst.mock.calls, ...db.deal.findFirst.mock.calls]) expect(call[0].where).toMatchObject({ tenantId: "t1", ownerId: "u-sales", deletedAt: null });
  });

  it("changes nothing: it only reads", async () => {
    await prepare("TASK_CREATE", sales, { title: "x" });
    expect(actions.createTask).not.toHaveBeenCalled();
  });

  it("tells the model when the contact is not one the person can see", async () => {
    db.contact.findFirst.mockResolvedValue(null);
    await expect(prepare("TASK_CREATE", sales, { title: "x", contactId: "someone-elses" })).rejects.toBeInstanceOf(ToolError);
  });

  it("does not let a salesperson give the task to someone else, but lets an admin within their business", async () => {
    await expect(prepare("TASK_CREATE", sales, { title: "x", assigneeId: "u-other" })).rejects.toThrow(/only assign records to yourself/);
    const out = await prepare("TASK_CREATE", admin, { title: "x", assigneeId: "u-sam" });
    expect(out.params.assigneeId).toBe("u-sam");
    expect(db.user.findFirst.mock.calls[0][0].where).toMatchObject({ id: "u-sam", isActive: true, tenantId: "t1" });
  });

  it("refuses a date that is not a date, and an empty title", async () => {
    await expect(prepare("TASK_CREATE", sales, { title: "x", dueDate: "2026-13-45" })).rejects.toBeInstanceOf(ToolError);
    await expect(prepare("TASK_CREATE", sales, { title: "   " })).rejects.toBeInstanceOf(ToolError);
  });

  it("on approval creates the task through the shared function, as the person", async () => {
    actions.createTask.mockResolvedValue({ id: "t9" });
    const done = await KINDS.TASK_CREATE.apply!(sales, { title: "Call Ada", description: null, priority: "HIGH", dueDate: "2026-11-05", contactId: null, dealId: null, assigneeId: null });
    expect(actions.createTask).toHaveBeenCalledWith(sales, expect.objectContaining({ title: "Call Ada", priority: "HIGH", status: "TODO", dueDate: new Date("2026-11-05") }));
    expect(actions.createTask.mock.calls[0][1].assigneeId).toBeUndefined();
    expect(done).toEqual({ entity: "task", id: "t9", href: "/tasks" });
  });

  it("checks an edited date again on approval", async () => {
    await expect(KINDS.TASK_CREATE.apply!(sales, { title: "x", dueDate: "soon" })).rejects.toBeInstanceOf(ToolError);
    expect(actions.createTask).not.toHaveBeenCalled();
  });
});

describe("TASK_CHANGE", () => {
  const task = { title: "Send invoice", status: "TODO", priority: "MEDIUM", dueDate: new Date("2026-11-02") };

  it("shows what changes, from what it is now, and remembers the status it expects", async () => {
    db.task.findFirst.mockResolvedValue(task);
    const out = await prepare("TASK_CHANGE", sales, { taskId: "t1", status: "DONE", dueDate: "2026-11-09" });
    expect(out.preview.lines).toEqual([{ label: "Task", value: "Send invoice" }, { label: "Status", value: "Todo → Done" }, { label: "Due", value: "2026-11-02 → 2026-11-09" }]);
    expect(out.params).toEqual({ taskId: "t1", changes: { status: "DONE", dueDate: "2026-11-09" }, expect: { status: "TODO" } });
    expect(JSON.stringify(db.task.findFirst.mock.calls[0][0].where)).toContain("u-sales");
  });

  it("refuses an invisible task, an empty change, and a change that is already so", async () => {
    db.task.findFirst.mockResolvedValue(null);
    await expect(prepare("TASK_CHANGE", sales, { taskId: "nope", status: "DONE" })).rejects.toThrow(/No task with that id is visible/);
    db.task.findFirst.mockResolvedValue(task);
    await expect(prepare("TASK_CHANGE", sales, { taskId: "t1" })).rejects.toThrow(/Say what should change/);
    await expect(prepare("TASK_CHANGE", sales, { taskId: "t1", status: "TODO" })).rejects.toThrow(/already looks like that/);
  });

  it("on approval changes it through the shared function", async () => {
    db.task.findFirst.mockResolvedValue({ status: "TODO" });
    actions.updateTask.mockResolvedValue({ id: "t1" });
    await KINDS.TASK_CHANGE.apply!(sales, { taskId: "t1", changes: { status: "DONE", dueDate: "2026-11-09" }, expect: { status: "TODO" } });
    expect(actions.updateTask).toHaveBeenCalledWith(sales, "t1", { status: "DONE", dueDate: new Date("2026-11-09") });
  });

  it("does nothing if the task moved on since AI suggested it, and says so", async () => {
    db.task.findFirst.mockResolvedValue({ status: "DONE" });
    await expect(KINDS.TASK_CHANGE.apply!(sales, { taskId: "t1", changes: { status: "CANCELLED" }, expect: { status: "TODO" } })).rejects.toMatchObject({ status: 409, code: "AI_PROPOSAL_STALE" });
    expect(actions.updateTask).not.toHaveBeenCalled();
  });

  it("does nothing if the task is gone", async () => {
    db.task.findFirst.mockResolvedValue(null);
    await expect(KINDS.TASK_CHANGE.apply!(sales, { taskId: "t1", changes: { status: "DONE" }, expect: { status: "TODO" } })).rejects.toBeInstanceOf(ApiError);
    expect(actions.updateTask).not.toHaveBeenCalled();
  });
});

describe("NOTE_CREATE", () => {
  it("needs a contact or a deal, and shows what will be logged", async () => {
    await expect(prepare("NOTE_CREATE", sales, { subject: "Called" })).rejects.toThrow(/Which contact or deal/);
    const out = await prepare("NOTE_CREATE", sales, { subject: "Called about shipping", body: "She will pay Friday.", type: "CALL", contactId: "c1" });
    expect(out.preview.title).toBe("Log a call");
    expect(out.preview.lines).toEqual([{ label: "Subject", value: "Called about shipping" }, { label: "Details", value: "She will pay Friday." }, { label: "About", value: "Adaeze Okafor" }]);
    expect(actions.logActivity).not.toHaveBeenCalled();
  });

  it("on approval logs it and points to the contact, or the deal", async () => {
    actions.logActivity.mockResolvedValue({ id: "a1" });
    expect(await KINDS.NOTE_CREATE.apply!(sales, { type: "NOTE", subject: "x", body: null, contactId: "c1", dealId: null })).toEqual({ entity: "activity", id: "a1", href: "/contacts/c1" });
    expect((await KINDS.NOTE_CREATE.apply!(sales, { type: "NOTE", subject: "x", body: null, contactId: null, dealId: "d1" })).href).toBe("/deals/d1");
  });
});

describe("STAGE_CHANGE", () => {
  it("shows the move and warns when it closes the deal", async () => {
    const out = await prepare("STAGE_CHANGE", sales, { dealId: "d1", stage: "CLOSED_WON" });
    expect(out.preview.lines).toContainEqual({ label: "Stage", value: "Discovery → Closed won" });
    expect(out.preview.warning).toMatch(/closes the deal as won/);
    expect(out.params).toMatchObject({ dealId: "d1", stage: "CLOSED_WON", fromStage: "DISCOVERY" });
    expect(db.deal.findFirst.mock.calls[0][0].where).toMatchObject({ id: "d1", tenantId: "t1", ownerId: "u-sales", deletedAt: null });
  });

  it("has no warning for an ordinary move, and warns when reopening a closed deal", async () => {
    expect((await prepare("STAGE_CHANGE", sales, { dealId: "d1", stage: "NEGOTIATION" })).preview.warning).toBeUndefined();
    db.deal.findFirst.mockResolvedValue({ title: "Old", stage: "CLOSED_LOST", contact: null });
    expect((await prepare("STAGE_CHANGE", sales, { dealId: "d1", stage: "NEGOTIATION" })).preview.warning).toMatch(/reopens/);
  });

  it("refuses an invisible deal and a move to the stage it is already in", async () => {
    db.deal.findFirst.mockResolvedValue(null);
    await expect(prepare("STAGE_CHANGE", sales, { dealId: "x", stage: "PROPOSAL" })).rejects.toThrow(/No deal with that id is visible/);
    db.deal.findFirst.mockResolvedValue({ title: "T", stage: "PROPOSAL", contact: null });
    await expect(prepare("STAGE_CHANGE", sales, { dealId: "d1", stage: "PROPOSAL" })).rejects.toThrow(/already in Proposal/);
  });

  it("on approval moves it through the shared function, only if it is still where it was", async () => {
    db.deal.findFirst.mockResolvedValue({ stage: "DISCOVERY" });
    actions.changeDealStage.mockResolvedValue({});
    const done = await KINDS.STAGE_CHANGE.apply!(sales, { dealId: "d1", stage: "NEGOTIATION", lostReason: null, fromStage: "DISCOVERY" });
    expect(actions.changeDealStage).toHaveBeenCalledWith(sales, "d1", { stage: "NEGOTIATION", lostReason: undefined });
    expect(done).toEqual({ entity: "deal", id: "d1", href: "/deals/d1" });

    actions.changeDealStage.mockClear();
    db.deal.findFirst.mockResolvedValue({ stage: "CLOSED_WON" });
    await expect(KINDS.STAGE_CHANGE.apply!(sales, { dealId: "d1", stage: "NEGOTIATION", lostReason: null, fromStage: "DISCOVERY" })).rejects.toMatchObject({ status: 409, code: "AI_PROPOSAL_STALE" });
    expect(actions.changeDealStage).not.toHaveBeenCalled();
  });
});

describe("MESSAGE_DRAFT", () => {
  it("holds the text to copy, warns about opt-outs, and can never be applied", async () => {
    const out = await prepare("MESSAGE_DRAFT", sales, { contactId: "c1", channel: "WHATSAPP", message: "Hi Ada, your order ships Friday." });
    expect(out.preview.draft).toEqual({ text: "Hi Ada, your order ships Friday." });
    expect(out.preview.warning).toBeUndefined();
    db.contact.findFirst.mockResolvedValue({ firstName: "A", lastName: "B", emailOptOut: true, whatsappOptIn: false });
    expect((await prepare("MESSAGE_DRAFT", sales, { contactId: "c1", channel: "EMAIL", subject: "Hi", message: "x" })).preview.warning).toMatch(/opted out of email/);
    expect((await prepare("MESSAGE_DRAFT", sales, { contactId: "c1", channel: "WHATSAPP", message: "x" })).preview.warning).toMatch(/not opted in to WhatsApp/);
    expect(KINDS.MESSAGE_DRAFT.apply).toBeUndefined();
  });

  it("only drafts for contacts the person can see", async () => {
    db.contact.findFirst.mockResolvedValue(null);
    await expect(prepare("MESSAGE_DRAFT", sales, { contactId: "x", channel: "EMAIL", message: "x" })).rejects.toThrow(/No contact with that id is visible/);
  });
});
