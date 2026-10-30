import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({ db: { aiConversation: { deleteMany: vi.fn() } } }));
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

  it("only ever touches conversations, never the spend records the ceiling needs", async () => {
    db.aiConversation.deleteMany.mockResolvedValue({ count: 0 });
    await purgeOldConversations("t1");
    expect(Object.keys(db)).toEqual(["aiConversation"]);
  });
});
