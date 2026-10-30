import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({
  db: {
    aiUsage: { count: vi.fn(), findMany: vi.fn() },
    aiConversation: { count: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock("@/lib/db", () => ({ db }));

import { EXPORTS } from "@/lib/export/registry";

const admin = { id: "u-admin", tenantId: "t1", role: "ADMIN", name: "Ada", email: "a@x.test" } as never;
const get = (entity: string, query = "") => new Request(`http://x.test/api/export/${entity}${query}`);
const rowsOf = async (entity: string, query = "") => {
  const plan = await EXPORTS[entity].plan(admin, get(entity, query), { includeDeleted: false });
  const out: unknown[][] = [];
  for await (const batch of plan.batches()) out.push(...batch);
  return { plan, out };
};

beforeEach(() => {
  vi.resetAllMocks();
  db.aiUsage.count.mockResolvedValue(1);
  db.aiConversation.count.mockResolvedValue(1);
});

describe("the AI export areas", () => {
  it("ai-usage lists token counts and an estimated cost in dollars, for the admin's business only", async () => {
    db.aiUsage.findMany.mockResolvedValueOnce([{ id: "a1", createdAt: new Date("2026-10-30T10:00:00Z"), userId: "u1", conversationId: "c1", model: "claude-sonnet-5-5", inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, costMicros: 3000 }]).mockResolvedValue([]);
    const { plan, out } = await rowsOf("ai-usage");
    expect(plan.headers).toEqual(["id", "createdAt", "userId", "conversationId", "model", "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "estimatedCostUsd"]);
    expect(out[0].at(-1)).toBe(0.003);
    expect(db.aiUsage.count.mock.calls[0][0].where).toEqual({ tenantId: "t1" });
  });

  it("takes a date range", async () => {
    db.aiUsage.findMany.mockResolvedValue([]);
    await rowsOf("ai-usage", "?from=2026-10-01&to=2026-10-31");
    const where = db.aiUsage.count.mock.calls[0][0].where;
    expect(where.tenantId).toBe("t1");
    expect(where.createdAt.gte).toBeInstanceOf(Date);
    expect(where.createdAt.lte).toBeInstanceOf(Date);
  });

  it("ai-conversations lists who chatted and when, never a title or any message text", async () => {
    db.aiConversation.findMany.mockResolvedValueOnce([{ id: "c1", createdAt: new Date("2026-10-30"), updatedAt: new Date("2026-10-30"), promptVersion: "1", user: { name: "Sam" }, _count: { messages: 6 } }]).mockResolvedValue([]);
    const { plan, out } = await rowsOf("ai-conversations");
    expect(plan.headers).toEqual(["id", "user", "createdAt", "updatedAt", "messages", "promptVersion"]);
    expect(out[0]).toEqual(["c1", "Sam", new Date("2026-10-30"), new Date("2026-10-30"), 6, "1"]);
    const select = db.aiConversation.findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty("title");
    expect(select).not.toHaveProperty("messages");
    expect(db.aiConversation.count.mock.calls[0][0].where).toEqual({ tenantId: "t1" });
  });

  it("are for admins only, and need no authenticator code", () => {
    for (const key of ["ai-usage", "ai-conversations"]) expect(EXPORTS[key]).toMatchObject({ adminOnly: true, stepUp: false, softDeleted: false });
  });
});
