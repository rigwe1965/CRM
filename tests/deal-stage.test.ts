import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, notify, automations } = vi.hoisted(() => ({
  db: { deal: { findFirst: vi.fn(), findFirstOrThrow: vi.fn(), update: vi.fn() } },
  notify: vi.fn(),
  automations: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/notifications", () => ({ notifyDealStageChange: notify }));
vi.mock("@/lib/automations", () => ({ runStageAutomations: automations }));
vi.mock("@/lib/plan-limits", () => ({ assertWithinPlan: vi.fn() }));

import { changeDealStage } from "@/lib/crm-actions";

const user = { id: "u1", tenantId: "t1", role: "ADMIN", name: "Ada" } as never;
const dealRow = (over: Record<string, unknown> = {}) => ({ id: "d1", stage: "QUALIFICATION", amount: 100, items: [], ...over });

beforeEach(() => {
  vi.resetAllMocks();
});

describe("changeDealStage", () => {
  it("a real move still stamps closedAt, uses the default probability and runs notifications and automations", async () => {
    db.deal.findFirst.mockResolvedValue({ stage: "QUALIFICATION" });
    db.deal.update.mockResolvedValue(dealRow({ stage: "CLOSED_WON" }));
    await changeDealStage(user, "d1", { stage: "CLOSED_WON" });
    const data = db.deal.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ stage: "CLOSED_WON", probability: 100 });
    expect(data.closedAt).toBeInstanceOf(Date);
    expect(notify).toHaveBeenCalledOnce();
    expect(automations).toHaveBeenCalledOnce();
  });

  it("posting the current closed stage changes nothing and fires nothing", async () => {
    db.deal.findFirst.mockResolvedValue({ stage: "CLOSED_WON" });
    db.deal.findFirstOrThrow.mockResolvedValue(dealRow({ stage: "CLOSED_WON" }));
    const out = await changeDealStage(user, "d1", { stage: "CLOSED_WON" });
    expect(db.deal.update).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(automations).not.toHaveBeenCalled();
    expect(out.stage).toBe("CLOSED_WON");
  });

  it("posting CLOSED_LOST without a reason keeps the stored reason", async () => {
    db.deal.findFirst.mockResolvedValue({ stage: "CLOSED_LOST" });
    db.deal.findFirstOrThrow.mockResolvedValue(dealRow({ stage: "CLOSED_LOST", lostReason: "Too expensive" }));
    const out = await changeDealStage(user, "d1", { stage: "CLOSED_LOST" });
    expect(db.deal.update).not.toHaveBeenCalled();
    expect(out.lostReason).toBe("Too expensive");
  });

  it("posting CLOSED_LOST with a new reason updates only the reason", async () => {
    db.deal.findFirst.mockResolvedValue({ stage: "CLOSED_LOST" });
    db.deal.update.mockResolvedValue(dealRow({ stage: "CLOSED_LOST", lostReason: "Went elsewhere" }));
    await changeDealStage(user, "d1", { stage: "CLOSED_LOST", lostReason: "Went elsewhere" });
    expect(db.deal.update.mock.calls[0][0].data).toEqual({ lostReason: "Went elsewhere" });
    expect(notify).not.toHaveBeenCalled();
  });

  it("an explicit probability on the same stage is applied without touching closedAt", async () => {
    db.deal.findFirst.mockResolvedValue({ stage: "NEGOTIATION" });
    db.deal.update.mockResolvedValue(dealRow({ stage: "NEGOTIATION", probability: 70 }));
    await changeDealStage(user, "d1", { stage: "NEGOTIATION", probability: 70 });
    expect(db.deal.update.mock.calls[0][0].data).toEqual({ probability: 70 });
  });

  it("reopening a closed deal clears closedAt", async () => {
    db.deal.findFirst.mockResolvedValue({ stage: "CLOSED_WON" });
    db.deal.update.mockResolvedValue(dealRow({ stage: "NEGOTIATION" }));
    await changeDealStage(user, "d1", { stage: "NEGOTIATION" });
    expect(db.deal.update.mock.calls[0][0].data).toMatchObject({ stage: "NEGOTIATION", closedAt: null });
    expect(notify).toHaveBeenCalledOnce();
  });
});
