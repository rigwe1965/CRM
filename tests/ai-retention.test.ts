import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({ db: { aiConversation: { deleteMany: vi.fn() }, aiProposal: { updateMany: vi.fn(), deleteMany: vi.fn() }, aiInboxRun: { deleteMany: vi.fn() }, aiTriage: { deleteMany: vi.fn() } } }));
vi.mock("@/lib/db", () => ({ db }));

import { AI_RETENTION_DAYS, purgeOldConversations } from "@/lib/ai/retention";

beforeEach(() => vi.clearAllMocks());

describe("purgeOldConversations", () => {
  it("keeps conversations for 90 days", () => expect(AI_RETENTION_DAYS).toBe(90));

  it("deletes one business's conversations quiet for longer than that, and reports how many", async () => {
    db.aiConversation.deleteMany.mockResolvedValue({ count: 3 });
    const now = new Date("2026-10-30T12:00:00Z");
    expect(await purgeOldConversations("t1", now)).toBe(3);
    const where = db.aiConversation.deleteMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe("t1");
    expect(where.updatedAt.lt).toEqual(new Date("2026-08-01T12:00:00Z")); // 90 days before
  });

  it("only ever touches conversations, proposals and run records, never the spend records the ceiling needs", async () => {
    db.aiConversation.deleteMany.mockResolvedValue({ count: 0 });
    await purgeOldConversations("t1");
    expect(Object.keys(db)).toEqual(["aiConversation", "aiProposal", "aiInboxRun", "aiTriage"]);
  });

  it("deletes decided or expired suggestions made on AI's own (no conversation) and old run records, after the same period", async () => {
    db.aiConversation.deleteMany.mockResolvedValue({ count: 0 });
    const now = new Date("2026-10-30T12:00:00Z");
    await purgeOldConversations("t1", now);
    const cutoff = new Date("2026-08-01T12:00:00Z");
    expect(db.aiProposal.deleteMany).toHaveBeenCalledWith({ where: { tenantId: "t1", conversationId: null, status: { not: "PENDING" }, createdAt: { lt: cutoff } } });
    expect(db.aiInboxRun.deleteMany).toHaveBeenCalledWith({ where: { tenantId: "t1", startedAt: { lt: cutoff } } });
    expect(db.aiTriage.deleteMany).toHaveBeenCalledWith({ where: { tenantId: "t1", createdAt: { lt: cutoff } } });
  });

  it("closes proposals nobody decided in time (expired), for that business only", async () => {
    db.aiConversation.deleteMany.mockResolvedValue({ count: 0 });
    const now = new Date("2026-10-30T12:00:00Z");
    await purgeOldConversations("t1", now);
    expect(db.aiProposal.updateMany).toHaveBeenCalledWith({ where: { tenantId: "t1", status: "PENDING", expiresAt: { lt: now } }, data: { status: "EXPIRED", decidedAt: now } });
  });
});
