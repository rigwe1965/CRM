import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, pay, wa } = vi.hoisted(() => ({
  db: { deal: { findMany: vi.fn() }, activity: { findMany: vi.fn() }, task: { findMany: vi.fn() } },
  pay: { paymentSummaries: vi.fn() },
  wa: { canReplyFreely: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/payments", () => pay);
vi.mock("@/lib/whatsapp", () => wa);

import { findCandidates, isoWeek, MAX_SUGGESTIONS } from "@/lib/ai/inbox/rules";

const NOW = new Date("2026-10-30T09:00:00Z"); // a Friday, ISO week 44
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const sales = { id: "u-sales", tenantId: "t1", role: "SALES", name: "Sam" } as never;
const admin = { id: "u-admin", tenantId: "t1", role: "ADMIN", name: "Ada" } as never;

const contact = (over: Record<string, unknown> = {}) => ({ id: "c1", firstName: "Adaeze", lastName: "Okafor", email: "ada@x.test", emailOptOut: false, phoneE164: "+2348011111111", whatsappOptIn: true, ...over });
const lateDeal = (id = "d1", over: Record<string, unknown> = {}) => ({ id, title: "Wholesale Bundles", amount: "1200", currency: "USD", contactId: "c1", contact: contact(), ...over });

type Setup = { late?: unknown[]; negotiating?: unknown[]; won?: unknown[]; acts?: unknown[]; recentTasks?: unknown[]; overdueTasks?: unknown[]; sums?: Record<string, unknown> };
function setup(s: Setup = {}) {
  db.deal.findMany.mockImplementation(async (a: { where: unknown }) => {
    const w = JSON.stringify(a.where);
    if (w.includes('"instalments":{"some"')) return s.late ?? [];
    if (w.includes("NEGOTIATION")) return s.negotiating ?? [];
    if (w.includes("CLOSED_WON")) return s.won ?? [];
    return [];
  });
  db.activity.findMany.mockResolvedValue(s.acts ?? []);
  db.task.findMany.mockImplementation(async (a: { where: unknown }) => (JSON.stringify(a.where).includes('"createdAt"') ? (s.recentTasks ?? []) : (s.overdueTasks ?? [])));
  pay.paymentSummaries.mockImplementation(async (deals: { id: string }[]) => new Map(deals.map((d) => [d.id, (s.sums ?? {})[d.id] ?? { paid: 0, balance: 0, nextDue: null, overdue: false }])));
  wa.canReplyFreely.mockResolvedValue(false);
}
const overdue = (daysAgo: number, amount = 400) => ({ paid: 400, balance: 800, overdue: true, nextDue: { dueDate: day(-daysAgo), amount } });

beforeEach(() => {
  vi.resetAllMocks();
  setup();
});

describe("isoWeek", () => {
  it("changes on Monday and handles the year's edges", () => {
    expect(isoWeek(new Date("2026-10-30"))).toBe("2026-W44");
    expect(isoWeek(new Date("2026-10-25"))).toBe("2026-W43"); // Sunday
    expect(isoWeek(new Date("2026-10-26"))).toBe("2026-W44"); // Monday
    expect(isoWeek(new Date("2027-01-01"))).toBe("2026-W53");
    expect(isoWeek(new Date("2026-12-31"))).toBe("2026-W53");
  });
});

describe("overdue instalments", () => {
  it("suggests a follow-up task and an email draft, with a reason built from the data", async () => {
    setup({ late: [lateDeal()], sums: { d1: overdue(5) } });
    const [c] = await findCandidates(sales, NOW);
    expect(c).toMatchObject({ rule: "OVERDUE_INSTALMENT", key: "inst:d1:2026-W44", subject: { type: "deal", id: "d1" }, priority: 105 });
    expect(c.reason).toBe('400.00 USD on "Wholesale Bundles" has been overdue for 5 days, and nobody has followed up in the last 3 days.');
    expect(c.task).toEqual({ title: "Follow up on overdue payment: Adaeze Okafor", priority: "MEDIUM", dueDate: "2026-10-30", contactId: "c1", dealId: "d1" });
    expect(c.message).toMatchObject({ contactId: "c1", channel: "EMAIL", subject: "Payment reminder: Wholesale Bundles", allowed: ["ada@x.test"] });
    expect(c.message!.text).toContain('400.00 USD for your order "Wholesale Bundles" was due on 2026-10-25');
  });

  it("drafts a WhatsApp message instead when the customer wrote in the last 24 hours", async () => {
    setup({ late: [lateDeal()], sums: { d1: overdue(8) } });
    wa.canReplyFreely.mockResolvedValue(true);
    const [c] = await findCandidates(sales, NOW);
    expect(c.message).toMatchObject({ channel: "WHATSAPP", allowed: ["+2348011111111"] });
    expect(c.task?.priority).toBe("HIGH"); // a week or more late
  });

  it("has no draft when the contact opted out of email and the WhatsApp window is closed, but still suggests the task", async () => {
    setup({ late: [lateDeal("d1", { contact: contact({ emailOptOut: true }) })], sums: { d1: overdue(3) } });
    const [c] = await findCandidates(sales, NOW);
    expect(c.message).toBeNull();
    expect(c.task).not.toBeNull();
  });

  it("stays quiet when someone already followed up in the last 3 days, by an activity or a task, on the deal or the customer", async () => {
    setup({ late: [lateDeal("d1"), lateDeal("d2", { contactId: "c2", contact: contact({ id: "c2" }) }), lateDeal("d3", { contactId: "c3", contact: contact({ id: "c3" }) })], sums: { d1: overdue(5), d2: overdue(5), d3: overdue(5) }, acts: [{ dealId: "d1", contactId: null, subject: "Called" }], recentTasks: [{ dealId: null, contactId: "c2" }] });
    const out = await findCandidates(sales, NOW);
    expect(out.map((c) => c.subject.id)).toEqual(["d3"]);
  });

  it("skips a deal whose instalments are covered, and ranks the later one first", async () => {
    setup({ late: [lateDeal("d1"), lateDeal("d2", { contactId: "c2", contact: contact({ id: "c2" }) }), lateDeal("d3", { contactId: "c3", contact: contact({ id: "c3" }) })], sums: { d1: overdue(2), d2: { paid: 1200, balance: 0, nextDue: null, overdue: false }, d3: overdue(20) } });
    expect((await findCandidates(sales, NOW)).map((c) => c.subject.id)).toEqual(["d3", "d1"]);
  });

  it("reads deals, activities and tasks only through the person's own scope", async () => {
    setup({ late: [lateDeal()], sums: { d1: overdue(5) } });
    await findCandidates(sales, NOW);
    const dealWhere = JSON.stringify(db.deal.findMany.mock.calls[0][0].where);
    expect(dealWhere).toContain('"ownerId":"u-sales"');
    expect(dealWhere).toContain('"tenantId":"t1"');
    expect(JSON.stringify(db.activity.findMany.mock.calls[0][0].where)).toContain('"authorId":"u-sales"');
    expect(JSON.stringify(db.task.findMany.mock.calls[0][0].where)).toContain("u-sales");
  });

  it("lets an admin see the whole business, never another", async () => {
    setup({ late: [lateDeal()], sums: { d1: overdue(5) } });
    await findCandidates(admin, NOW);
    const dealWhere = JSON.stringify(db.deal.findMany.mock.calls[0][0].where);
    expect(dealWhere).toContain('"tenantId":"t1"');
    expect(dealWhere).not.toContain("ownerId");
  });
});

describe("the other rules", () => {
  it("suggests a follow-up on a deal that has sat in Negotiation with no activity", async () => {
    setup({ negotiating: [{ id: "d5", title: "Frontal order", updatedAt: day(-20), contactId: "c9", contact: { firstName: "Bola", lastName: "Adeyemi" } }] });
    const [c] = await findCandidates(sales, NOW);
    expect(c).toMatchObject({ rule: "STALE_NEGOTIATION", key: "stale:d5:2026-W44", priority: 70 });
    expect(c.reason).toBe('"Frontal order" has been in Negotiation for 20 days with no activity.');
    expect(c.task?.title).toBe('Follow up on "Frontal order"');
    expect(c.message).toBeNull();
  });

  it("ignores a Negotiation deal that has had activity in the window", async () => {
    setup({ negotiating: [{ id: "d5", title: "Frontal order", updatedAt: day(-20), contactId: "c9", contact: null }], acts: [{ dealId: null, contactId: "c9" }] });
    expect(await findCandidates(sales, NOW)).toEqual([]);
  });

  it("suggests agreeing a payment plan for a won deal with money owed and no schedule, only when something is owed", async () => {
    setup({ won: [{ id: "d6", title: "Restock", amount: "500", currency: "USD", contactId: "c4", contact: { firstName: "Dayo", lastName: "Balogun" } }, { id: "d7", title: "Paid", amount: "100", currency: "USD", contactId: null, contact: null }], sums: { d6: { paid: 0, balance: 500, nextDue: null, overdue: false }, d7: { paid: 100, balance: 0, nextDue: null, overdue: false } } });
    const out = await findCandidates(sales, NOW);
    expect(out.map((c) => c.subject.id)).toEqual(["d6"]);
    expect(out[0]).toMatchObject({ rule: "WON_NO_SCHEDULE", priority: 40 });
    expect(out[0].reason).toBe('"Restock" is won with 500.00 USD still unpaid and no payment schedule.');
  });

  it("suggests moving a task that is well overdue to tomorrow", async () => {
    setup({ overdueTasks: [{ id: "t1", title: "Send invoice", dueDate: day(-6) }] });
    const [c] = await findCandidates(sales, NOW);
    expect(c).toMatchObject({ rule: "OVERDUE_TASK", key: "task:t1:2026-W44", taskChange: { taskId: "t1", dueDate: "2026-10-31" }, task: null });
    expect(c.reason).toBe('"Send invoice" was due 6 days ago and is still open.');
    expect(JSON.stringify(db.task.findMany.mock.calls.at(-1)![0].where)).toContain('"assigneeId":"u-sales"');
  });
});

describe("ranking and the daily cap", () => {
  it("puts overdue money first, then quiet deals, then plans, then tasks, and never more than ten", async () => {
    const deals = Array.from({ length: 6 }, (_, i) => lateDeal(`L${i}`, { contactId: `cl${i}`, contact: contact({ id: `cl${i}` }) }));
    setup({
      late: deals,
      sums: Object.fromEntries(deals.map((d, i) => [d.id, overdue(i + 1)])),
      negotiating: Array.from({ length: 4 }, (_, i) => ({ id: `N${i}`, title: `N${i}`, updatedAt: day(-20 - i), contactId: null, contact: null })),
      won: [{ id: "W1", title: "W1", amount: "10", currency: "USD", contactId: null, contact: null }],
      sums2: undefined,
      overdueTasks: [{ id: "T1", title: "T1", dueDate: day(-5) }],
    } as Setup);
    pay.paymentSummaries.mockImplementation(async (ds: { id: string }[]) => new Map(ds.map((d) => [d.id, d.id.startsWith("L") ? overdue(Number(d.id.slice(1)) + 1) : { paid: 0, balance: 10, nextDue: null, overdue: false }])));
    const out = await findCandidates(sales, NOW);
    expect(out).toHaveLength(MAX_SUGGESTIONS);
    expect(out.slice(0, 6).map((c) => c.rule)).toEqual(Array(6).fill("OVERDUE_INSTALMENT"));
    expect(out[0].subject.id).toBe("L5"); // the longest overdue first
    expect(out[6].rule).toBe("STALE_NEGOTIATION");
    expect(out.map((c) => c.priority)).toEqual([...out.map((c) => c.priority)].sort((a, b) => b - a));
  });

  it("returns nothing for a quiet business", async () => {
    expect(await findCandidates(sales, NOW)).toEqual([]);
  });
});
