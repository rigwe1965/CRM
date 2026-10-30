import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, audit } = vi.hoisted(() => ({
  db: {
    aiConversation: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn(), updateMany: vi.fn() },
    aiMessage: { aggregate: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
  audit: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/audit", () => ({ audit }));
vi.mock("@/lib/ai/tools", () => ({ TOOL_DEFINITIONS: [] }));

import { appendMessages, deleteConversation, listConversations, loadConversation, renderMessages, startConversation, toParams } from "@/lib/ai/conversations";
import { IVY_PROMPT_VERSION } from "@/lib/ai/prompt";

const me = { id: "u1", tenantId: "t1", email: "me@x.test" };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("who can see a chat", () => {
  it("only the user who started it, in their own business: every lookup names both", async () => {
    db.aiConversation.findFirst.mockResolvedValue(null);
    expect(await loadConversation(me, "c1")).toBeNull();
    expect(db.aiConversation.findFirst.mock.calls[0][0].where).toEqual({ id: "c1", tenantId: "t1", userId: "u1" });
    await listConversations(me);
    expect(db.aiConversation.findMany.mock.calls[0][0].where).toEqual({ tenantId: "t1", userId: "u1" });
    expect(db.aiConversation.findMany.mock.calls[0][0].take).toBe(30);
  });

  it("starts a chat for that user with the current prompt version and a short title from the question", async () => {
    db.aiConversation.create.mockResolvedValue({ id: "c9", title: "x" });
    await startConversation(me, "Who owes me money this week and how late are they, in every currency please?");
    const data = db.aiConversation.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ tenantId: "t1", userId: "u1", promptVersion: IVY_PROMPT_VERSION });
    expect(data.title.length).toBeLessThanOrEqual(60);
  });
});

describe("saving messages", () => {
  const stored = [
    { role: "ASSISTANT" as const, content: [{ type: "tool_use", id: "t", name: "x", input: {} }] },
    { role: "USER" as const, content: [{ type: "tool_result", tool_use_id: "t", content: "{}" }] },
  ];

  it("saves them together, after the existing ones, in order", async () => {
    db.aiMessage.aggregate.mockResolvedValue({ _max: { position: 4 } });
    db.aiMessage.create.mockImplementation((a) => a);
    db.aiConversation.updateMany.mockReturnValue("touch");
    db.$transaction.mockResolvedValue([]);
    await appendMessages("t1", "c1", stored);
    const ops = db.$transaction.mock.calls[0][0];
    expect(ops).toHaveLength(3);
    expect(ops[0].data).toMatchObject({ tenantId: "t1", conversationId: "c1", position: 5, role: "ASSISTANT" });
    expect(ops[1].data).toMatchObject({ position: 6, role: "USER" });
    expect(ops[2]).toBe("touch");
    expect(db.aiMessage.aggregate.mock.calls[0][0].where).toEqual({ tenantId: "t1", conversationId: "c1" });
  });

  it("starts at position 0 in an empty chat", async () => {
    db.aiMessage.aggregate.mockResolvedValue({ _max: { position: null } });
    db.aiMessage.create.mockImplementation((a) => a);
    db.$transaction.mockResolvedValue([]);
    await appendMessages("t1", "c1", stored.slice(0, 1));
    expect(db.$transaction.mock.calls[0][0][0].data.position).toBe(0);
  });

  it("refuses the second of two answers racing on one chat, in words", async () => {
    db.aiMessage.aggregate.mockResolvedValue({ _max: { position: 0 } });
    db.aiMessage.create.mockImplementation((a) => a);
    db.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" }));
    await expect(appendMessages("t1", "c1", stored)).rejects.toMatchObject({ status: 409, code: "AI_BUSY" });
  });

  it("lets any other database error through", async () => {
    db.aiMessage.aggregate.mockResolvedValue({ _max: { position: 0 } });
    db.aiMessage.create.mockImplementation((a) => a);
    db.$transaction.mockRejectedValue(new Error("connection lost"));
    await expect(appendMessages("t1", "c1", stored)).rejects.toThrow("connection lost");
  });
});

describe("deleting a chat", () => {
  it("is false for a chat that is not yours, and deletes nothing", async () => {
    db.aiConversation.findFirst.mockResolvedValue(null);
    expect(await deleteConversation(me, "c1", new Request("http://x.test"))).toBe(false);
    expect(db.aiConversation.deleteMany).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("audits metadata only, never the title (which comes from what was asked), then deletes", async () => {
    db.aiConversation.findFirst.mockResolvedValue({ id: "c1", createdAt: new Date("2026-10-01"), title: "Who owes Adaeze Okafor money?", _count: { messages: 6 } });
    expect(await deleteConversation(me, "c1", new Request("http://x.test"))).toBe(true);
    expect(db.aiConversation.findFirst.mock.calls[0][0].select).not.toHaveProperty("title");
    expect(audit.mock.calls[0][1]).toEqual({ action: "assistant.conversation.deleted", entity: "ai_conversation", entityId: "c1", data: { createdAt: new Date("2026-10-01"), messages: 6 } });
    expect(JSON.stringify(audit.mock.calls[0][1])).not.toContain("Adaeze");
    expect(db.aiConversation.deleteMany.mock.calls[0][0].where).toEqual({ id: "c1", tenantId: "t1", userId: "u1" });
  });
});

describe("renderMessages: what the browser is shown", () => {
  const ctxBlock = { type: "text", text: "<context>\nToday: 2026-10-30 (UTC)\n</context>" };

  it("shows the person's own words, not the context block", () => {
    expect(renderMessages([{ role: "USER", content: [ctxBlock, { type: "text", text: "Who owes me money?" }] }])).toEqual([{ role: "user", text: "Who owes me money?", tools: [] }]);
  });

  it("shows each answer as one bubble across tool rounds, with a chip per lookup and no raw tool data", () => {
    const rows = [
      { role: "USER" as const, content: [ctxBlock, { type: "text", text: "Who owes me?" }] },
      { role: "ASSISTANT" as const, content: [{ type: "thinking", thinking: "secret reasoning", signature: "sig" }, { type: "text", text: "Let me look." }, { type: "tool_use", id: "t1", name: "list_overdue", input: { withinDays: 7 } }] },
      { role: "USER" as const, content: [{ type: "tool_result", tool_use_id: "t1", content: '{"rows":[{"customer":"PRIVATE"}]}' }] },
      { role: "ASSISTANT" as const, content: [{ type: "text", text: "Two are late." }] },
    ];
    const out = renderMessages(rows);
    expect(out).toEqual([
      { role: "user", text: "Who owes me?", tools: [] },
      { role: "assistant", text: "Let me look.\n\nTwo are late.", tools: ["Checked overdue payments"] },
    ]);
    expect(JSON.stringify(out)).not.toMatch(/secret reasoning|PRIVATE|withinDays|signature/);
  });

  it("copes with a plain-string message and an unknown tool", () => {
    expect(renderMessages([{ role: "USER", content: "hello" }])).toEqual([{ role: "user", text: "hello", tools: [] }]);
    expect(renderMessages([{ role: "ASSISTANT", content: [{ type: "tool_use", id: "t", name: "something_new", input: {} }] }])[0].tools).toEqual(["Looked something up"]);
  });

  it("keeps a question that never got an answer", () => {
    expect(renderMessages([{ role: "USER", content: [{ type: "text", text: "q1" }] }, { role: "USER", content: [{ type: "text", text: "q2" }] }]).map((m) => m.text)).toEqual(["q1", "q2"]);
  });
});

describe("toParams", () => {
  it("gives the API the stored content untouched", () => {
    const content = [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text: "hi" }];
    expect(toParams([{ role: "USER", content: "q" }, { role: "ASSISTANT", content }])).toEqual([{ role: "user", content: "q" }, { role: "assistant", content }]);
  });
});
