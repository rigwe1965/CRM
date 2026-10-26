import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, sendReminderNow, reminderHistory } = vi.hoisted(() => ({
  db: { deal: { findFirst: vi.fn() } },
  sendReminderNow: vi.fn(),
  reminderHistory: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/automations/settings", () => ({ loadInstalmentEmails: async () => ({ mode: "LIVE" }) }));
vi.mock("@/lib/automations/instalment-emails", () => ({ sendReminderNow, reminderHistory }));
// Skip auth and rate limiting: this test is about who can see the deal and what is passed on.
vi.mock("@/lib/route", () => ({
  authed:
    (handler: (ctx: unknown) => Promise<Response>) =>
    async (req: Request, context: { params: Promise<unknown> }) =>
      handler({ req, user: { id: "u1", role: "SALES", tenantId: "t1", email: "sam@shop.test" }, params: await context.params }),
}));

import { GET, POST } from "@/app/api/deals/[id]/reminders/route";

const ctx = { params: Promise.resolve({ id: "d1" }) };
const post = (body: unknown) =>
  POST(new Request("http://x.test/api/deals/d1/reminders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), ctx);

beforeEach(() => {
  vi.clearAllMocks();
  db.deal.findFirst.mockResolvedValue({ id: "d1", title: "Adaeze order", contact: { email: "ada@customer.test", emailOptOut: false, deletedAt: null } });
  reminderHistory.mockResolvedValue([]);
  sendReminderNow.mockResolvedValue({ kind: "OVERDUE_1", test: false, to: "ada@customer.test" });
});

describe("/api/deals/:id/reminders", () => {
  it("only finds deals the caller may see, and says whether the customer can be emailed", async () => {
    const res = await GET(new Request("http://x.test/api/deals/d1/reminders"), ctx);
    expect(db.deal.findFirst.mock.calls[0][0].where).toMatchObject({ id: "d1", deletedAt: null, tenantId: "t1", ownerId: "u1" });
    expect(await res.json()).toEqual({ data: { mode: "LIVE", canEmail: true, reminders: [] } });

    db.deal.findFirst.mockResolvedValue({ id: "d1", title: "x", contact: { email: "ada@customer.test", emailOptOut: true, deletedAt: null } });
    expect((await (await GET(new Request("http://x.test/api/deals/d1/reminders"), ctx)).json()).data.canEmail).toBe(false);
  });

  it("is a 404 for a deal the caller cannot see, and sends nothing", async () => {
    db.deal.findFirst.mockResolvedValue(null);
    await expect(post({ instalmentId: "i1" })).rejects.toMatchObject({ status: 404 });
    expect(sendReminderNow).not.toHaveBeenCalled();
  });

  it("needs an instalment id", async () => {
    await expect(post({})).rejects.toMatchObject({ status: 422 });
    expect(sendReminderNow).not.toHaveBeenCalled();
  });

  it("sends the reminder for that instalment as the caller", async () => {
    const res = await post({ instalmentId: "i1" });
    expect(res.status).toBe(201);
    expect(sendReminderNow).toHaveBeenCalledWith(expect.objectContaining({ id: "u1", tenantId: "t1" }), "d1", "i1");
  });
});
