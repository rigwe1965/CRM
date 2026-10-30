import { beforeEach, describe, expect, it, vi } from "vitest";

const { holder, audit, lib } = vi.hoisted(() => ({
  holder: { user: { id: "u1", tenantId: "t1", role: "SALES", name: "Sam", tenantWritable: true } as Record<string, unknown> },
  audit: vi.fn(),
  lib: { listProposals: vi.fn(), approveProposal: vi.fn(), declineProposal: vi.fn() },
}));

vi.mock("@/lib/route", () => ({
  authed: (handler: (ctx: unknown) => Promise<Response>) => async (req: Request, context?: { params: Promise<unknown> }) => {
    try {
      return await handler({ req, user: holder.user, params: await context?.params });
    } catch (e) {
      const { toErrorResponse } = await import("@/lib/api");
      return toErrorResponse(e);
    }
  },
}));
vi.mock("@/lib/audit", () => ({ audit }));
vi.mock("@/lib/ai/proposals", () => lib);

import * as list from "@/app/api/assistant/proposals/route";
import * as approve from "@/app/api/assistant/proposals/[id]/approve/route";
import * as decline from "@/app/api/assistant/proposals/[id]/decline/route";
import { allowedWhenReadOnly } from "@/lib/plans";

type H = (req: Request, ctx?: { params: Promise<{ id: string }> }) => Promise<Response>;
const post = (h: unknown, body: unknown) => (h as H)(new Request("http://x.test/api/assistant/proposals/p1/x", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "p1" }) });
const dto = (over: Record<string, unknown> = {}) => ({ id: "p1", status: "APPLIED", preview: { title: "Create a task", lines: [{ label: "Task", value: "Call Ada" }] }, ...over });

beforeEach(() => {
  vi.resetAllMocks();
  holder.user = { id: "u1", tenantId: "t1", role: "SALES", name: "Sam", tenantWritable: true };
});

describe("GET /api/assistant/proposals", () => {
  it("lists the person's own cards for one chat", async () => {
    lib.listProposals.mockResolvedValue([dto()]);
    const res = await (list.GET as unknown as H)(new Request("http://x.test/api/assistant/proposals?conversationId=c1"));
    expect((await res.json()).data).toHaveLength(1);
    expect(lib.listProposals).toHaveBeenCalledWith(holder.user, "c1");
  });

  it("needs a chat id", async () => {
    expect((await (list.GET as unknown as H)(new Request("http://x.test/api/assistant/proposals"))).status).toBe(422);
    expect(lib.listProposals).not.toHaveBeenCalled();
  });
});

describe("POST /api/assistant/proposals/:id/approve", () => {
  it("approves as the signed-in person, passes their edits on, and writes one audit entry naming what it was", async () => {
    lib.approveProposal.mockResolvedValue(dto());
    const res = await post(approve.POST, { edits: { title: "Call Ada early" } });
    expect(res.status).toBe(200);
    expect(lib.approveProposal).toHaveBeenCalledWith(holder.user, "p1", { title: "Call Ada early" });
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit.mock.calls[0][1]).toMatchObject({ action: "assistant.proposal.approve", entity: "ai_proposal", entityId: "p1" });
    expect(audit.mock.calls[0][1].summary).toBe("Approved Ivy's proposal (Create a task · Task: Call Ada): applied");
  });

  it("works with no edits", async () => {
    lib.approveProposal.mockResolvedValue(dto());
    expect((await post(approve.POST, {})).status).toBe(200);
    expect(lib.approveProposal).toHaveBeenCalledWith(holder.user, "p1", undefined);
  });

  it("does nothing in a read-only workspace", async () => {
    holder.user = { ...holder.user, tenantWritable: false };
    const res = await post(approve.POST, {});
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("READ_ONLY");
    expect(lib.approveProposal).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("reports a failed approval as the answer, with the reason, and audits it as not done", async () => {
    lib.approveProposal.mockResolvedValue(dto({ status: "FAILED", failure: "The task is now Done." }));
    const body = await (await post(approve.POST, {})).json();
    expect(body.data).toMatchObject({ status: "FAILED", failure: "The task is now Done." });
    expect(audit.mock.calls[0][1].summary).toMatch(/failed$/);
  });

  it("passes on refusals (already decided, not found) without an audit entry", async () => {
    const { ApiError } = await import("@/lib/api");
    lib.approveProposal.mockRejectedValue(new ApiError(409, "This proposal was already applied.", "AI_PROPOSAL_DECIDED"));
    const res = await post(approve.POST, {});
    expect(res.status).toBe(409);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("POST /api/assistant/proposals/:id/decline", () => {
  it("declines and audits it", async () => {
    lib.declineProposal.mockResolvedValue(dto({ status: "DECLINED" }));
    expect((await post(decline.POST, {})).status).toBe(200);
    expect(lib.declineProposal).toHaveBeenCalledWith(holder.user, "p1");
    expect(audit.mock.calls[0][1]).toMatchObject({ action: "assistant.proposal.decline", entityId: "p1" });
  });

  it("is allowed in a read-only workspace, since it changes nothing in the business", async () => {
    holder.user = { ...holder.user, tenantWritable: false };
    lib.declineProposal.mockResolvedValue(dto({ status: "DECLINED" }));
    expect((await post(decline.POST, {})).status).toBe(200);
  });
});

describe("read-only workspaces", () => {
  it("let these routes through the plan check; the approve route stops itself", () => {
    expect(allowedWhenReadOnly("/api/assistant/proposals/p1/approve")).toBe(true);
    expect(allowedWhenReadOnly("/api/assistant/proposals/p1/decline")).toBe(true);
  });
});
