import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { propose } = vi.hoisted(() => ({ propose: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/ai/proposals", () => ({ propose }));

import { PROPOSAL_TOOLS, toolByName } from "@/lib/ai/tools";
import { ToolError } from "@/lib/ai/tools/types";

const ctx = { user: { id: "u1", tenantId: "t1", role: "SALES" } as never, owned: {} as never, now: new Date("2026-10-30T12:00:00Z"), conversationId: "c1" };
const run = (name: string, input: unknown) => toolByName(name)!.run(ctx, input);

beforeEach(() => {
  vi.resetAllMocks();
  propose.mockResolvedValue({ id: "p1", preview: { title: "x", lines: [] } });
});

describe("the proposal tools", () => {
  it("each save one proposal of the right kind, with the chat and person from the context", async () => {
    const cases: [string, string, unknown][] = [
      ["propose_task", "TASK_CREATE", { title: "Call Ada" }],
      ["propose_task_change", "TASK_CHANGE", { taskId: "t1", status: "DONE" }],
      ["propose_note", "NOTE_CREATE", { subject: "Called", contactId: "c1" }],
      ["propose_stage_change", "STAGE_CHANGE", { dealId: "d1", stage: "NEGOTIATION" }],
      ["draft_message", "MESSAGE_DRAFT", { contactId: "c1", channel: "EMAIL", message: "Hello" }],
    ];
    for (const [name, kind, input] of cases) {
      propose.mockClear();
      await run(name, input);
      expect(propose).toHaveBeenCalledTimes(1);
      expect(propose.mock.calls[0][0]).toBe(ctx);
      expect(propose.mock.calls[0][1]).toBe(kind);
    }
    expect(PROPOSAL_TOOLS).toHaveLength(cases.length);
  });

  it("tell the model plainly that nothing has been done, and that a draft is not sent", async () => {
    const queued = JSON.parse(await run("propose_task", { title: "Call Ada" }));
    expect(queued).toMatchObject({ queued: true, proposalId: "p1" });
    expect(queued.note).toMatch(/NOTHING has been done/);
    const drafted = JSON.parse(await run("draft_message", { contactId: "c1", channel: "WHATSAPP", message: "Hi" }));
    expect(drafted.note).toMatch(/NOTHING has been sent/);
  });

  it("check the model's input before anything is saved, in words it can act on", async () => {
    await expect(run("propose_task", { title: "x", dueDate: "next friday" })).rejects.toThrow(/Invalid input for propose_task.*dueDate/);
    await expect(run("propose_task", {})).rejects.toBeInstanceOf(ToolError);
    await expect(run("propose_stage_change", { dealId: "d1", stage: "WON" })).rejects.toThrow(/stage/);
    await expect(run("draft_message", { contactId: "c1", channel: "SMS", message: "x" })).rejects.toThrow(/channel/);
    expect(propose).not.toHaveBeenCalled();
  });

  it("pass on what the proposal refuses (switched off, no such record) as a message to the model", async () => {
    propose.mockRejectedValue(new ToolError("Proposed actions are switched off for this business."));
    await expect(run("propose_task", { title: "x" })).rejects.toThrow(/switched off/);
  });

  it("cannot reach the code that changes records: only the proposal library", () => {
    const dir = join(__dirname, "..", "src", "lib", "ai", "tools");
    for (const file of readdirSync(dir)) {
      const src = readFileSync(join(dir, file), "utf8");
      expect(src, file).not.toMatch(/crm-actions|\.apply\(|sendWhatsApp|sendMail/);
    }
    // The model-facing file imports only schemas from the kinds file, never its `apply`.
    expect(readFileSync(join(dir, "propose.ts"), "utf8")).toMatch(/import \{ messageDraftInput, noteCreateInput, stageChangeInput, taskChangeInput, taskCreateInput \} from "@\/lib\/ai\/proposal-kinds"/);
  });

  it("are the only code that runs a proposal's action: the approval library and nothing the model can call", () => {
    const src = readFileSync(join(__dirname, "..", "src", "lib", "ai", "proposals.ts"), "utf8");
    const proposeFn = src.slice(src.indexOf("export async function propose("), src.indexOf("const mine ="));
    expect(proposeFn).not.toMatch(/\.apply\(/);
    expect(src.match(/\.apply\(/g)).toHaveLength(1);
  });
});
