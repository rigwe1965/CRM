import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { errs, tools, assertUnderCeiling, recordUsage } = vi.hoisted(() => {
  class APIError extends Error {
    status?: number;
  }
  class AuthenticationError extends APIError {}
  class PermissionDeniedError extends APIError {}
  class RateLimitError extends APIError {}
  class BadRequestError extends APIError {}
  class APIConnectionError extends APIError {}
  class APIUserAbortError extends APIError {}
  return {
    errs: { APIError, AuthenticationError, PermissionDeniedError, RateLimitError, BadRequestError, APIConnectionError, APIUserAbortError },
    tools: {} as Record<string, { name: string; label: (raw: unknown) => string; run: (ctx: unknown, raw: unknown) => Promise<string> }>,
    assertUnderCeiling: vi.fn(),
    recordUsage: vi.fn(),
  };
});

vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    static APIError = errs.APIError;
    static AuthenticationError = errs.AuthenticationError;
    static PermissionDeniedError = errs.PermissionDeniedError;
    static RateLimitError = errs.RateLimitError;
    static BadRequestError = errs.BadRequestError;
    static APIConnectionError = errs.APIConnectionError;
    static APIUserAbortError = errs.APIUserAbortError;
  }
  return { default: FakeAnthropic };
});
vi.mock("@/lib/ai/status", () => ({ assertUnderCeiling }));
vi.mock("@/lib/ai/usage", () => ({ recordUsage }));
vi.mock("@/lib/ai/tools", async () => {
  const { ToolError } = await import("@/lib/ai/tools/types");
  return { ToolError, TOOL_DEFINITIONS: [{ name: "lookup", description: "x", input_schema: { type: "object" }, eager_input_streaming: true }], toolByName: (n: string) => tools[n] };
});

import { ApiError } from "@/lib/api";
import { DEADLINE_MS, explain, IVY_EFFORT, MAX_ROUNDS, MAX_TOKENS, runIvy, type IvyEvent, type StoredMessage } from "@/lib/ai/ivy";
import { SYSTEM_PROMPT } from "@/lib/ai/prompt";
import { IVY_MODEL } from "@/lib/ai/pricing";
import { ToolError } from "@/lib/ai/tools/types";

const NOW = new Date("2026-10-30T12:00:00Z");
const ctx = { user: { id: "u1", tenantId: "t1" }, owned: { tenantId: "t1" }, now: NOW } as never;
const usage = { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: null, cache_creation_input_tokens: null };

type Reply = { text?: string[]; content?: unknown[]; stop_reason?: string; model?: string } | Error;
const say = (text: string): Reply => ({ text: [text], content: [{ type: "text", text }], stop_reason: "end_turn" });
const call = (id: string, name = "lookup", input: unknown = {}, text?: string): Reply => ({
  text: text ? [text] : [],
  content: [...(text ? [{ type: "text", text }] : []), { type: "tool_use", id, name, input }],
  stop_reason: "tool_use",
});

function fakeClient(replies: Reply[]) {
  const calls: { params: Record<string, unknown>; opts: { signal?: AbortSignal; timeout?: number }; messages: unknown }[] = [];
  const stream = vi.fn((params: Record<string, unknown>, opts: { signal?: AbortSignal; timeout?: number }) => {
    calls.push({ params, opts, messages: JSON.parse(JSON.stringify(params.messages)) });
    const reply = replies.shift();
    const handlers: ((d: string) => void)[] = [];
    return {
      on: (event: string, cb: (d: string) => void) => event === "text" && handlers.push(cb),
      finalMessage: async () => {
        if (!reply) throw new Error("the script ran out of replies");
        if (reply instanceof Error) throw reply;
        for (const t of reply.text ?? []) handlers.forEach((h) => h(t));
        return { content: reply.content ?? [], stop_reason: reply.stop_reason ?? "end_turn", model: reply.model ?? IVY_MODEL, usage };
      },
    };
  });
  return { calls, client: { beta: { messages: { stream } } } as never };
}

async function ask(replies: Reply[], over: Partial<Parameters<typeof runIvy>[0]> = {}) {
  const events: IvyEvent[] = [];
  const saved: StoredMessage[][] = [];
  const { client, calls } = fakeClient(replies);
  const result = await runIvy({ client, ctx, conversationId: "conv1", history: [], userBlocks: [{ type: "text", text: "Who owes me money?" }], persist: async (m) => void saved.push(m), emit: (e) => events.push(e), ...over });
  return { events, saved, calls, result };
}
const textOf = (events: IvyEvent[]) => events.filter((e): e is Extract<IvyEvent, { type: "text" }> => e.type === "text").map((e) => e.delta).join("");

beforeEach(() => {
  vi.resetAllMocks();
  assertUnderCeiling.mockResolvedValue(undefined);
  recordUsage.mockResolvedValue(100);
  for (const k of Object.keys(tools)) delete tools[k];
  tools.lookup = { name: "lookup", label: () => "Looking things up", run: vi.fn(async () => '{"rows":[]}') };
});
afterEach(() => vi.useRealTimers());

describe("a plain answer", () => {
  it("streams the text, saves the question and the answer, and finishes", async () => {
    const { events, saved, result } = await ask([say("Nobody owes you anything.")]);
    expect(events).toEqual([{ type: "text", delta: "Nobody owes you anything." }, { type: "done" }]);
    expect(saved).toEqual([
      [{ role: "USER", content: [{ type: "text", text: "Who owes me money?" }] }],
      [{ role: "ASSISTANT", content: [{ type: "text", text: "Nobody owes you anything." }] }],
    ]);
    expect(result).toMatchObject({ stopped: "answered", rounds: 1, tools: [], costMicros: 100 });
  });

  it("saves the question before the model is called, so it is never lost", async () => {
    const order: string[] = [];
    const { client } = fakeClient([say("ok")]);
    (client as { beta: { messages: { stream: (...a: unknown[]) => unknown } } }).beta.messages.stream = ((...a: unknown[]) => (order.push("model"), a)) as never;
    await runIvy({ client, ctx, conversationId: "c", history: [], userBlocks: [{ type: "text", text: "q" }], persist: async () => void order.push("persist"), emit: () => undefined }).catch(() => undefined);
    expect(order[0]).toBe("persist");
  });

  it("asks the model exactly as planned: Sonnet 5.5, low effort, cached, with fallback, and nothing the model rejects", async () => {
    const { calls } = await ask([say("ok")]);
    const p = calls[0].params;
    expect(p).toMatchObject({ model: "claude-sonnet-5-5", max_tokens: MAX_TOKENS, system: SYSTEM_PROMPT, output_config: { effort: IVY_EFFORT }, cache_control: { type: "ephemeral" }, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    expect(IVY_EFFORT).toBe("low");
    for (const banned of ["thinking", "temperature", "top_p", "top_k", "tool_choice"]) expect(p, banned).not.toHaveProperty(banned);
    expect((p.tools as { name: string }[]).map((t) => t.name)).toEqual(["lookup"]);
    expect(calls[0].opts.timeout).toBeLessThanOrEqual(DEADLINE_MS);
  });

  it("records each model call against the business, naming the model that actually answered", async () => {
    await ask([call("t1"), { ...say("done"), model: "claude-sonnet-5" }]);
    expect(recordUsage).toHaveBeenCalledTimes(2);
    expect(recordUsage.mock.calls[0][0]).toEqual({ tenantId: "t1", userId: "u1", conversationId: "conv1", model: IVY_MODEL, usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 } });
    expect(recordUsage.mock.calls[1][0].model).toBe("claude-sonnet-5");
  });
});

describe("tool rounds", () => {
  it("runs the tool, saves the call and its result together, and gives the result to the next call", async () => {
    const { events, saved, calls, result } = await ask([call("tu1", "lookup", { q: 1 }, "Let me check."), say("You have 2 overdue.")]);
    expect(events.map((e) => e.type)).toEqual(["text", "tool", "tool", "text", "text", "done"]);
    expect(events.filter((e) => e.type === "tool")).toEqual([
      { type: "tool", id: "tu1", name: "lookup", label: "Looking things up", status: "start" },
      { type: "tool", id: "tu1", name: "lookup", label: "Looking things up", status: "done" },
    ]);
    expect(textOf(events)).toBe("Let me check.\n\nYou have 2 overdue."); // rounds read as separate paragraphs
    expect(saved).toHaveLength(3); // three writes: the question, the tool call with its result (together), the answer
    expect(saved[1].map((m) => m.role)).toEqual(["ASSISTANT", "USER"]);
    expect((saved[1][1].content as unknown[])[0]).toEqual({ type: "tool_result", tool_use_id: "tu1", content: '{"rows":[]}' });
    const second = calls[1].messages as { role: string; content: { type: string }[] }[];
    expect(second.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(second[2].content[0].type).toBe("tool_result");
    expect(result).toMatchObject({ stopped: "answered", rounds: 2, tools: ["lookup"] });
  });

  it("tells each tool which chat it is answering in, so a proposal's card lands in the right chat", async () => {
    await ask([call("tu1", "lookup", { q: 1 }), say("Done.")]);
    const toolCtx = (tools.lookup.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(toolCtx).toMatchObject({ conversationId: "conv1", user: { id: "u1", tenantId: "t1" } });
  });

  it("runs several tool calls from one turn together and returns every result in order", async () => {
    tools.lookup.run = vi.fn(async (_c, raw) => JSON.stringify({ n: (raw as { n: number }).n }));
    const reply: Reply = { content: [{ type: "tool_use", id: "a", name: "lookup", input: { n: 1 } }, { type: "tool_use", id: "b", name: "lookup", input: { n: 2 } }], stop_reason: "tool_use" };
    const { saved } = await ask([reply, say("ok")]);
    const results = saved[1][1].content as { tool_use_id: string; content: string }[];
    expect(results.map((r) => [r.tool_use_id, r.content])).toEqual([["a", '{"n":1}'], ["b", '{"n":2}']]);
  });

  it("tells the model about an unknown tool instead of failing", async () => {
    const { saved, events } = await ask([call("x", "drop_database"), say("sorry")]);
    expect((saved[1][1].content as { is_error: boolean; content: string }[])[0]).toMatchObject({ is_error: true });
    expect((saved[1][1].content as { content: string }[])[0].content).toContain("no tool called drop_database");
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("gives the model a tool's own complaint so it can correct itself", async () => {
    tools.lookup.run = async () => {
      throw new ToolError("No deal with that id is visible to you.");
    };
    const { saved, events } = await ask([call("t"), say("I could not find it.")]);
    expect(saved[1][1].content).toEqual([{ type: "tool_result", tool_use_id: "t", is_error: true, content: "No deal with that id is visible to you." }]);
    expect(events.find((e) => e.type === "tool" && e.status === "error")).toBeTruthy();
  });

  it("never shows the model an internal error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    tools.lookup.run = async () => {
      throw new Error('relation "Deal" does not exist (SECRET_QUERY)');
    };
    const { saved } = await ask([call("t"), say("sorry")]);
    expect(JSON.stringify(saved)).not.toContain("SECRET_QUERY");
    expect((saved[1][1].content as { content: string }[])[0].content).toMatch(/lookup failed/);
    spy.mockRestore();
  });
});

describe("limits", () => {
  it("stops after six tool rounds, says so, and saves a finished turn", async () => {
    const replies: Reply[] = Array.from({ length: 10 }, (_, i) => call(`t${i}`));
    const { calls, saved, events, result } = await ask(replies);
    expect(MAX_ROUNDS).toBe(6);
    expect(calls).toHaveLength(6);
    expect(result).toMatchObject({ stopped: "round_limit", rounds: 6 });
    const last = saved.at(-1)![0];
    expect(last.role).toBe("ASSISTANT");
    expect(JSON.stringify(last.content)).toContain("narrower question");
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("stops when the time is up, between rounds, and says so", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    tools.lookup.run = async () => {
      vi.setSystemTime(new Date(Date.now() + DEADLINE_MS + 1000));
      return "{}";
    };
    const { calls, result, events } = await ask([call("t"), say("never reached")]);
    expect(calls).toHaveLength(1);
    expect(result.stopped).toBe("deadline");
    expect(textOf(events)).toContain("taking longer than I can allow");
  });

  it("does not call the model at all when the spending ceiling is already reached", async () => {
    assertUnderCeiling.mockRejectedValue(new ApiError(429, "This month's spending limit for AI has been reached.", "AI_CEILING_REACHED"));
    const { calls, events, result } = await ask([say("x")]);
    expect(calls).toHaveLength(0);
    expect(events).toEqual([{ type: "error", code: "AI_CEILING_REACHED", message: "This month's spending limit for AI has been reached." }]);
    expect(result.stopped).toBe("error");
  });

  it("stops in the middle of an answer when the ceiling is reached after a tool round", async () => {
    assertUnderCeiling.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ApiError(429, "limit", "AI_CEILING_REACHED"));
    const { calls, events, saved } = await ask([call("t"), say("never")]);
    expect(calls).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "error", code: "AI_CEILING_REACHED" });
    expect(saved).toHaveLength(2); // the question and the finished tool round: nothing half-written
  });
});

describe("what the model can refuse or cut off", () => {
  it("reports a refusal and saves nothing of it", async () => {
    const { events, saved, result } = await ask([{ content: [{ type: "text", text: "..." }], stop_reason: "refusal" }]);
    expect(events).toEqual([{ type: "error", code: "AI_REFUSED", message: expect.stringContaining("cannot help") }]);
    expect(saved).toHaveLength(1); // only the question
    expect(result.stopped).toBe("refused");
  });

  it("runs no tool from a cut-off turn", async () => {
    const reply = { content: [{ type: "tool_use", id: "t", name: "lookup", input: { partial: true } }], stop_reason: "max_tokens" };
    const { events, result } = await ask([reply]);
    expect(tools.lookup.run).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ type: "error", code: "AI_TOO_LONG" });
    expect(result.stopped).toBe("truncated");
  });

  it("keeps a plain answer that was cut off at the token limit", async () => {
    const { saved, events, result } = await ask([{ ...say("A long answer that"), stop_reason: "max_tokens" }]);
    expect(saved.at(-1)).toEqual([{ role: "ASSISTANT", content: [{ type: "text", text: "A long answer that" }] }]);
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(result.stopped).toBe("truncated");
  });

  it("treats a stop reason it does not expect as a failure, not an answer", async () => {
    const { events, result } = await ask([{ content: [], stop_reason: "pause_turn" }]);
    expect(events.at(-1)).toMatchObject({ type: "error", code: "AI_FAILED" });
    expect(result.stopped).toBe("error");
  });
});

describe("stopping and failing", () => {
  it("does nothing when the browser has already gone", async () => {
    const abort = new AbortController();
    abort.abort();
    const { calls, events, result } = await ask([say("x")], { signal: abort.signal });
    expect(calls).toHaveLength(0);
    expect(events).toEqual([]);
    expect(result.stopped).toBe("aborted");
  });

  it("ends quietly when the person presses Stop mid-answer", async () => {
    const { events, result } = await ask([new errs.APIUserAbortError("aborted")]);
    expect(events).toEqual([]);
    expect(result.stopped).toBe("aborted");
  });

  it("turns each provider failure into words the person can act on, without detail", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cases: [Error, string][] = [
      [new errs.AuthenticationError("invalid x-api-key sk-ant-SECRET"), "AI_KEY_REJECTED"],
      [new errs.PermissionDeniedError("no"), "AI_KEY_REJECTED"],
      [new errs.RateLimitError("429"), "AI_PROVIDER_BUSY"],
      [new errs.BadRequestError("Your credit balance is too low to access the Anthropic API"), "AI_NO_CREDIT"],
      [new errs.APIConnectionError("ECONNRESET"), "AI_UNREACHABLE"],
      [new errs.BadRequestError("messages.3: something about the question text"), "AI_FAILED"],
      [new TypeError("bug with a customer name Adaeze"), "AI_FAILED"],
    ];
    for (const [thrown, code] of cases) {
      const { events } = await ask([thrown]);
      const e = events.at(-1) as Extract<IvyEvent, { type: "error" }>;
      expect(e.code, code).toBe(code);
      expect(e.message).not.toMatch(/sk-ant|SECRET|Adaeze|messages\.3/);
    }
    spy.mockRestore();
  });

  it("reports a clash from saving (two answers at once) as the error it is", async () => {
    const { events } = await ask([say("x")], { persist: async () => Promise.reject(new ApiError(409, "AI is still answering your last question.", "AI_BUSY")) });
    expect(events).toEqual([{ type: "error", code: "AI_BUSY", message: "AI is still answering your last question." }]);
  });

  it("explain() passes our own errors through with their code", () => {
    expect(explain(new ApiError(403, "AI is switched off", "AI_DISABLED"))).toEqual({ code: "AI_DISABLED", message: "AI is switched off" });
  });
});

describe("earlier turns", () => {
  it("sends the saved history first and adds the new question after it", async () => {
    const history = [
      { role: "user", content: [{ type: "text", text: "<context>…</context>" }, { type: "text", text: "first question" }] },
      { role: "assistant", content: [{ type: "text", text: "first answer" }] },
    ] as never;
    const { calls } = await ask([say("second answer")], { history, userBlocks: [{ type: "text", text: "second question" }] });
    const sent = calls[0].messages as { role: string }[];
    expect(sent.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(JSON.stringify(sent[0])).toContain("first question"); // verbatim, never rewritten
  });
});
