import { beforeEach, describe, expect, it, vi } from "vitest";

const { holder, roles, gate, client, convo, runIvy, audit, db, assistantStatus, outcomes } = vi.hoisted(() => ({
  outcomes: vi.fn(),
  holder: { user: { id: "u1", tenantId: "t1", role: "SALES", name: "Sam Seller", email: "sam@x.test" } as Record<string, unknown> },
  roles: new Map<string, unknown[]>(),
  gate: vi.fn(),
  client: vi.fn(),
  convo: { load: vi.fn(), start: vi.fn(), append: vi.fn(), list: vi.fn(), remove: vi.fn() },
  runIvy: vi.fn(),
  audit: vi.fn(),
  db: { tenant: { findFirst: vi.fn() } },
  assistantStatus: vi.fn(),
}));

vi.mock("@/lib/route", () => ({
  authed:
    (handler: (ctx: unknown) => Promise<Response>, ...r: unknown[]) => {
      const wrapped = async (req: Request, context?: { params: Promise<unknown> }) => handler({ req, user: holder.user, params: await context?.params });
      roles.set(String(handler).slice(0, 80), r);
      return wrapped;
    },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/audit", () => ({ audit }));
vi.mock("@/lib/ai/status", () => ({ assertCanAsk: gate, assistantStatus }));
vi.mock("@/lib/ai/client", () => ({ anthropicFor: client }));
vi.mock("@/lib/ai/ivy", () => ({ runIvy }));
vi.mock("@/lib/ai/proposals", () => ({ takeOutcomes: outcomes }));
vi.mock("@/lib/ai/tools", () => ({ TOOL_DEFINITIONS: [] }));
vi.mock("@/lib/ai/conversations", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/conversations")>()),
  loadConversation: convo.load,
  startConversation: convo.start,
  appendMessages: convo.append,
  listConversations: convo.list,
  deleteConversation: convo.remove,
}));

import * as chat from "@/app/api/assistant/chat/route";
import * as status from "@/app/api/assistant/status/route";
import * as list from "@/app/api/assistant/conversations/route";
import * as one from "@/app/api/assistant/conversations/[id]/route";
import { IVY_PROMPT_VERSION } from "@/lib/ai/prompt";
import { MAX_MESSAGES } from "@/lib/ai/conversations";
import { allowedWhenReadOnly } from "@/lib/plans";

type H = (req: Request, ctx?: { params: Promise<{ id: string }> }) => Promise<Response>;
const post = (body: unknown, signal?: AbortSignal) =>
  (chat.POST as unknown as H)(new Request("http://x.test/api/assistant/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal }));
const events = async (res: Response) => (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));

beforeEach(() => {
  vi.resetAllMocks();
  holder.user = { id: "u1", tenantId: "t1", role: "SALES", name: "Sam Seller", email: "sam@x.test" };
  gate.mockResolvedValue({});
  client.mockResolvedValue({ fake: "client" });
  convo.start.mockResolvedValue({ id: "c-new", title: "Who owes me?" });
  db.tenant.findFirst.mockResolvedValue({ name: "Ivycandy Hair LLC", brandName: "Ivycandy Hair" });
  runIvy.mockImplementation(async (o: { emit: (e: unknown) => void }) => {
    o.emit({ type: "text", delta: "Hello" });
    o.emit({ type: "done" });
    return { stopped: "answered" };
  });
});

describe("POST /api/assistant/chat: before anything is streamed", () => {
  it("is open to every signed-in user (no role asked for)", () => {
    expect([...roles.values()].every((r) => r.length === 0)).toBe(true);
  });

  it("checks the gates first and goes no further when one fails", async () => {
    gate.mockRejectedValue(Object.assign(new Error("Ivy is switched off"), { status: 403, code: "AI_DISABLED" }));
    await expect(post({ message: "hi" })).rejects.toMatchObject({ code: "AI_DISABLED" });
    expect(client).not.toHaveBeenCalled();
    expect(convo.start).not.toHaveBeenCalled();
    expect(runIvy).not.toHaveBeenCalled();
  });

  it("rejects an empty or oversize question", async () => {
    await expect(post({ message: "   " })).rejects.toMatchObject({ status: 422 });
    await expect(post({ message: "x".repeat(4001) })).rejects.toMatchObject({ status: 422 });
    await expect(post({})).rejects.toMatchObject({ status: 422 });
    expect(gate).not.toHaveBeenCalled();
  });

  it("will not open someone else's chat: it is simply not found", async () => {
    convo.load.mockResolvedValue(null);
    await expect(post({ conversationId: "theirs", message: "hi" })).rejects.toMatchObject({ status: 404 });
    expect(convo.load).toHaveBeenCalledWith(expect.objectContaining({ id: "u1", tenantId: "t1" }), "theirs");
    expect(runIvy).not.toHaveBeenCalled();
  });

  it("will not continue a chat started under older instructions", async () => {
    convo.load.mockResolvedValue({ id: "c1", title: "t", promptVersion: "0-old", messages: [] });
    await expect(post({ conversationId: "c1", message: "hi" })).rejects.toMatchObject({ status: 409, code: "AI_CONVERSATION_STALE" });
    expect(runIvy).not.toHaveBeenCalled();
  });

  it("will not continue a chat that has reached its length limit", async () => {
    convo.load.mockResolvedValue({ id: "c1", title: "t", promptVersion: IVY_PROMPT_VERSION, messages: Array.from({ length: MAX_MESSAGES }, () => ({ role: "USER", content: [] })) });
    await expect(post({ conversationId: "c1", message: "hi" })).rejects.toMatchObject({ status: 409, code: "AI_CONVERSATION_FULL" });
  });
});

describe("POST /api/assistant/chat: a new chat", () => {
  it("starts the chat, tells the browser its id first, and streams newline-delimited events", async () => {
    const res = await post({ message: "Who owes me?" });
    expect(res.headers.get("Content-Type")).toContain("application/x-ndjson");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(convo.start).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" }), "Who owes me?");
    expect(await events(res)).toEqual([{ type: "conversation", id: "c-new", title: "Who owes me?" }, { type: "text", delta: "Hello" }, { type: "done" }]);
  });

  it("puts who is asking in the first message, as the context, and the question after it", async () => {
    await (await post({ message: "Who owes me?" })).text();
    const blocks = runIvy.mock.calls[0][0].userBlocks as { text: string }[];
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toContain("<context>");
    expect(blocks[0].text).toContain("Business: Ivycandy Hair");
    expect(blocks[0].text).toContain("Asking: Sam Seller (sales)");
    expect(blocks[0].text).toContain("only the records they own");
    expect(blocks[1].text).toBe("Who owes me?");
    expect(runIvy.mock.calls[0][0].history).toEqual([]);
  });

  it("works as the signed-in user: a salesperson's own scope, an admin's whole business", async () => {
    await (await post({ message: "hi" })).text();
    expect(runIvy.mock.calls[0][0].ctx).toMatchObject({ owned: { tenantId: "t1", ownerId: "u1" } });
    holder.user = { ...holder.user, id: "u2", role: "ADMIN" };
    await (await post({ message: "hi" })).text();
    expect(runIvy.mock.calls[1][0].ctx.owned).toEqual({ tenantId: "t1" });
    expect((runIvy.mock.calls[1][0].userBlocks as { text: string }[])[0].text).toContain("every record in the business");
  });

  it("saves messages into that chat and business", async () => {
    runIvy.mockImplementation(async (o: { persist: (m: unknown[]) => Promise<void> }) => {
      await o.persist([{ role: "USER", content: [] }]);
      return {};
    });
    await (await post({ message: "hi" })).text();
    expect(convo.append).toHaveBeenCalledWith("t1", "c-new", [{ role: "USER", content: [] }]);
  });

  it("writes one audit entry with metadata only: never the question", async () => {
    await (await post({ message: "How much does Adaeze Okafor owe me?" })).text();
    expect(audit).toHaveBeenCalledTimes(1);
    const [, entry, req] = audit.mock.calls[0];
    expect(entry).toMatchObject({ action: "assistant.ask", entity: "ai_conversation", entityId: "c-new" });
    expect(JSON.stringify(entry)).not.toMatch(/Adaeze|owe me/);
    expect(req).toBeInstanceOf(Request);
  });

  it("reports a run that blows up as an error event and still closes the stream", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    runIvy.mockRejectedValue(new Error("boom with a secret"));
    const out = await events(await post({ message: "hi" }));
    expect(out.at(-1)).toEqual({ type: "error", code: "AI_FAILED", message: "Ivy could not answer that. Please try again." });
    expect(JSON.stringify(out)).not.toContain("secret");
    spy.mockRestore();
  });

  it("tells the loop to stop when the browser goes away", async () => {
    const abort = new AbortController();
    let seen: AbortSignal | undefined;
    runIvy.mockImplementation(async (o: { signal: AbortSignal }) => {
      seen = o.signal;
      return {};
    });
    const res = await post({ message: "hi" }, abort.signal);
    await res.text();
    expect(seen?.aborted).toBe(false);
    abort.abort();
    expect(seen?.aborted).toBe(true);
  });
});

describe("POST /api/assistant/chat: continuing a chat", () => {
  it("sends the saved history and no second context block, and does not start another chat", async () => {
    convo.load.mockResolvedValue({
      id: "c1", title: "Earlier", promptVersion: IVY_PROMPT_VERSION,
      messages: [{ role: "USER", content: [{ type: "text", text: "first" }] }, { role: "ASSISTANT", content: [{ type: "text", text: "answer" }] }],
    });
    const out = await events(await post({ conversationId: "c1", message: "and now?" }));
    expect(convo.start).not.toHaveBeenCalled();
    expect(out[0]).toEqual({ type: "conversation", id: "c1", title: "Earlier" });
    const o = runIvy.mock.calls[0][0];
    expect(o.userBlocks).toEqual([{ type: "text", text: "and now?" }]);
    expect(o.history).toEqual([{ role: "user", content: [{ type: "text", text: "first" }] }, { role: "assistant", content: [{ type: "text", text: "answer" }] }]);
    expect(db.tenant.findFirst).not.toHaveBeenCalled();
    expect(outcomes).toHaveBeenCalledWith(expect.objectContaining({ id: "u1", tenantId: "t1" }), "c1");
  });

  it("puts the note about how Ivy's earlier proposals ended in front of the question, once", async () => {
    convo.load.mockResolvedValue({ id: "c1", title: "Earlier", promptVersion: IVY_PROMPT_VERSION, messages: [{ role: "USER", content: [{ type: "text", text: "first" }] }, { role: "ASSISTANT", content: [{ type: "text", text: "answer" }] }] });
    const note = ["<proposal_outcomes>", "- done", "</proposal_outcomes>"].join(String.fromCharCode(10));
    outcomes.mockResolvedValue(note);
    await events(await post({ conversationId: "c1", message: "thanks" }));
    expect(runIvy.mock.calls[0][0].userBlocks).toEqual([{ type: "text", text: note }, { type: "text", text: "thanks" }]);
  });

  it("asks for no outcomes when a chat is new", async () => {
    await events(await post({ message: "hi" }));
    expect(outcomes).not.toHaveBeenCalled();
  });
});

describe("GET /api/assistant/status", () => {
  const base = { enabled: true, keyConfigured: true, level: "ok", resetsOn: "2026-11-01", spentUsd: 4.2, ceilingUsd: 10, monthlyCeilingUsd: 10 };
  const get = async () => (await (await (status.GET as unknown as H)(new Request("http://x.test"))).json()).data;

  it("is ready when on, with a key and a ceiling not reached", async () => {
    assistantStatus.mockResolvedValue(base);
    expect(await get()).toEqual({ ready: true, reason: null, resetsOn: null });
  });

  it("says why not, in the order a person would fix things", async () => {
    assistantStatus.mockResolvedValue({ ...base, enabled: false });
    expect((await get()).reason).toBe("AI_DISABLED");
    assistantStatus.mockResolvedValue({ ...base, keyConfigured: false });
    expect((await get()).reason).toBe("AI_NOT_CONFIGURED");
    assistantStatus.mockResolvedValue({ ...base, level: "unset" });
    expect((await get()).reason).toBe("AI_CEILING_UNSET");
    assistantStatus.mockResolvedValue({ ...base, level: "reached" });
    expect(await get()).toEqual({ ready: false, reason: "AI_CEILING_REACHED", resetsOn: "2026-11-01" });
  });

  it("holds no spending figures, for everyone", async () => {
    assistantStatus.mockResolvedValue(base);
    const text = JSON.stringify(await get());
    expect(text).not.toMatch(/spent|ceiling|4\.2|10/);
  });
});

describe("conversation routes", () => {
  it("lists only the caller's own chats", async () => {
    convo.list.mockResolvedValue([{ id: "c1", title: "t", updatedAt: new Date("2026-10-30") }]);
    const res = await (list.GET as unknown as H)(new Request("http://x.test"));
    expect(convo.list).toHaveBeenCalledWith(expect.objectContaining({ id: "u1", tenantId: "t1" }));
    expect((await res.json()).data).toHaveLength(1);
  });

  it("shows one chat rendered, marking it stale or full, without raw thinking or tool data", async () => {
    convo.load.mockResolvedValue({
      id: "c1", title: "t", promptVersion: "old",
      messages: [{ role: "USER", content: [{ type: "text", text: "<context>x</context>" }, { type: "text", text: "q" }] }, { role: "ASSISTANT", content: [{ type: "thinking", thinking: "SECRET" }, { type: "text", text: "a" }] }],
    });
    const body = (await (await (one.GET as unknown as H)(new Request("http://x.test"), { params: Promise.resolve({ id: "c1" }) })).json()).data;
    expect(body).toMatchObject({ id: "c1", stale: true, full: false, messages: [{ role: "user", text: "q" }, { role: "assistant", text: "a" }] });
    expect(JSON.stringify(body)).not.toMatch(/SECRET|context/);
  });

  it("404s for a chat that is not the caller's, for reading and for deleting", async () => {
    convo.load.mockResolvedValue(null);
    convo.remove.mockResolvedValue(false);
    const params = { params: Promise.resolve({ id: "theirs" }) };
    await expect((one.GET as unknown as H)(new Request("http://x.test"), params)).rejects.toMatchObject({ status: 404 });
    await expect((one.DELETE as unknown as H)(new Request("http://x.test", { method: "DELETE" }), params)).rejects.toMatchObject({ status: 404 });
  });

  it("deletes the caller's own chat", async () => {
    convo.remove.mockResolvedValue(true);
    const res = await (one.DELETE as unknown as H)(new Request("http://x.test", { method: "DELETE" }), { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(204);
    expect(convo.remove).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" }), "c1", expect.any(Request));
  });
});

describe("read-only workspaces", () => {
  it("can still use Ivy (it only reads business data), but nothing else new", () => {
    expect(allowedWhenReadOnly("/api/assistant/chat")).toBe(true);
    expect(allowedWhenReadOnly("/api/assistant/conversations/abc")).toBe(true);
    expect(allowedWhenReadOnly("/api/deals")).toBe(false);
    expect(allowedWhenReadOnly("/api/assistantx")).toBe(false);
  });
});
