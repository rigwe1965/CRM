import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, settings, spent } = vi.hoisted(() => ({
  db: { aiUsage: { create: vi.fn(), count: vi.fn(), deleteMany: vi.fn() } },
  settings: vi.fn(),
  spent: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/ai/settings", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/settings")>()), loadAssistantSettings: settings }));
vi.mock("@/lib/ai/usage", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/usage")>()), monthToDateMicros: spent }));

import { RESERVE_MICROS, reserveDocument, userShare } from "@/lib/ai/documents/reserve";

const sam = { id: "u1", tenantId: "t1", role: "SALES" };
/** `count` answers the day's number first, then this person's. */
const counts = (today: number, mine: number) => db.aiUsage.count.mockResolvedValueOnce(today).mockResolvedValueOnce(mine);

beforeEach(() => {
  vi.resetAllMocks();
  db.aiUsage.create.mockResolvedValue({ id: "r1" });
  db.aiUsage.deleteMany.mockResolvedValue({ count: 1 });
  settings.mockResolvedValue({ enabled: true, monthlyCeilingUsd: 10, documentsDailyCap: 20 });
  spent.mockResolvedValue(0);
});

describe("reserveDocument", () => {
  it("saves a placeholder with a held cost before the call, and gives it back once", async () => {
    counts(1, 1);
    const release = await reserveDocument(sam);
    expect(db.aiUsage.create.mock.calls[0][0].data).toMatchObject({ tenantId: "t1", userId: "u1", purpose: "DOCUMENT", costMicros: RESERVE_MICROS });
    expect(db.aiUsage.deleteMany).not.toHaveBeenCalled();
    await release();
    await release();
    expect(db.aiUsage.deleteMany).toHaveBeenCalledTimes(1);
    expect(db.aiUsage.deleteMany.mock.calls[0][0].where).toEqual({ id: "r1", tenantId: "t1" });
  });

  it("refuses the call that would pass the day's number, counting calls already in flight, and gives its place back", async () => {
    counts(21, 1); // the placeholder itself is the 21st
    await expect(reserveDocument(sam)).rejects.toMatchObject({ status: 429, code: "AI_DOCUMENTS_CAP" });
    expect(db.aiUsage.deleteMany).toHaveBeenCalledTimes(1);
  });

  it("lets a person who is not an admin use half the day's number, and an admin all of it", async () => {
    expect(userShare(20, false)).toBe(10);
    expect(userShare(1, false)).toBe(1);
    expect(userShare(20, true)).toBe(20);
    counts(11, 11);
    await expect(reserveDocument(sam)).rejects.toMatchObject({ code: "AI_DOCUMENTS_CAP" });
    counts(11, 11);
    await expect(reserveDocument({ ...sam, role: "ADMIN" })).resolves.toBeTypeOf("function");
  });

  it("refuses when the placeholder takes the month to its ceiling", async () => {
    counts(1, 1);
    spent.mockResolvedValue(10_000_000);
    await expect(reserveDocument(sam)).rejects.toMatchObject({ code: "AI_CEILING_REACHED" });
    expect(db.aiUsage.deleteMany).toHaveBeenCalledTimes(1);
  });

  it("gives the place back when the checks themselves fail", async () => {
    db.aiUsage.count.mockRejectedValue(new Error("db down"));
    await expect(reserveDocument(sam)).rejects.toThrow("db down");
    expect(db.aiUsage.deleteMany).toHaveBeenCalledTimes(1);
  });
});
