import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, whatsapp } = vi.hoisted(() => ({
  db: { automationSetting: { findUnique: vi.fn(), upsert: vi.fn() }, user: { count: vi.fn() }, contact: { count: vi.fn() }, deal: { count: vi.fn() } },
  whatsapp: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/whatsapp", () => ({ whatsappConfigured: whatsapp }));

import { dismissOnboarding, onboardingView } from "@/lib/onboarding";

const set = (o: { users?: number; contacts?: number; deals?: number; wa?: boolean; dismissed?: boolean }) => {
  db.user.count.mockResolvedValue(o.users ?? 1);
  db.contact.count.mockResolvedValue(o.contacts ?? 0);
  db.deal.count.mockResolvedValue(o.deals ?? 0);
  whatsapp.mockResolvedValue(o.wa ?? false);
  db.automationSetting.findUnique.mockResolvedValue(o.dismissed ? { config: { dismissed: true } } : null);
};
beforeEach(() => vi.clearAllMocks());

describe("onboarding checklist", () => {
  it("starts with nothing done and works each step out from the business own data", async () => {
    set({});
    const v = await onboardingView("t1");
    expect(v).toMatchObject({ dismissed: false, allDone: false });
    expect(v.steps.map((s) => [s.key, s.done])).toEqual([["customers", false], ["order", false], ["team", false], ["whatsapp", false]]);
    set({ contacts: 40, deals: 1, users: 2, wa: true });
    const done = await onboardingView("t1");
    expect(done.allDone).toBe(true);
  });
  it("counts only this business and only live records", async () => {
    set({});
    await onboardingView("t1");
    expect(db.contact.count).toHaveBeenCalledWith({ where: { tenantId: "t1", deletedAt: null } });
    expect(db.deal.count).toHaveBeenCalledWith({ where: { tenantId: "t1", deletedAt: null } });
    expect(db.user.count).toHaveBeenCalledWith({ where: { tenantId: "t1", isActive: true } });
  });
  it("remembers a dismissal per business", async () => {
    set({ dismissed: true });
    expect((await onboardingView("t1")).dismissed).toBe(true);
    await dismissOnboarding("t1", "u1", true);
    expect(db.automationSetting.upsert.mock.calls[0][0]).toMatchObject({ where: { tenantId_key: { tenantId: "t1", key: "onboarding" } }, create: { tenantId: "t1", config: { dismissed: true } } });
  });
});
