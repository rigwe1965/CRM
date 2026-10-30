import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, rs, view } = vi.hoisted(() => ({
  db: { deal: { findFirst: vi.fn() }, contact: { findFirst: vi.fn() }, organization: { findFirst: vi.fn() } },
  rs: { replaceSchedule: vi.fn() },
  view: { dealPaymentsView: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/crm-actions", () => ({ changeDealStage: vi.fn(), createContact: vi.fn(), createDeal: vi.fn(), createTask: vi.fn(), logActivity: vi.fn(), updateTask: vi.fn() }));
vi.mock("@/lib/record-payment", () => ({ recordPayment: vi.fn() }));
vi.mock("@/lib/replace-schedule", async (orig) => ({ ...(await orig<typeof import("@/lib/replace-schedule")>()), replaceSchedule: rs.replaceSchedule }));
vi.mock("@/lib/payments", async (orig) => ({ ...(await orig<typeof import("@/lib/payments")>()), dealPaymentsView: view.dealPaymentsView }));

import { ToolError } from "@/lib/ai/tools/types";
import { addMonthsUtc, evenSchedule, KINDS } from "@/lib/ai/proposal-kinds";

const sales = { id: "u-sales", tenantId: "t1", role: "SALES", name: "Sam" } as never;
type Out = { params: Record<string, unknown>; preview: { title: string; lines: { label: string; value: string }[]; warning?: string; confirm?: { title?: string; button: string; message: string } } };
const prepare = (raw: unknown) => (KINDS.SCHEDULE_REPLACE.prepare as unknown as (u: never, r: unknown) => Promise<Out>)(sales, raw);
const line = (out: Out, label: string) => out.preview.lines.find((l) => l.label === label)?.value;
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);
const future = (n: number) => iso(new Date(Date.now() + n * 86_400_000));

const deal = { id: "d1", title: "Wholesale Bundles", amount: "1200", currency: "USD", contact: { firstName: "Adaeze", lastName: "Okafor" } };

beforeEach(() => {
  vi.resetAllMocks();
  db.deal.findFirst.mockResolvedValue(deal);
  view.dealPaymentsView.mockResolvedValue({ dealAmount: 1200, currency: "USD", summary: { paid: 0, balance: 1200 }, instalments: [] });
});

describe("the arithmetic the model never does", () => {
  it("splits a total into equal parts with the odd cents on the last", () => {
    expect(evenSchedule(1200, 3, d("2026-12-01"), "MONTH").map((r) => r.amount)).toEqual([400, 400, 400]);
    expect(evenSchedule(100, 3, d("2026-12-01"), "MONTH").map((r) => r.amount)).toEqual([33.33, 33.33, 33.34]);
    expect(evenSchedule(0.05, 2, d("2026-12-01"), "WEEK").map((r) => r.amount)).toEqual([0.02, 0.03]);
    for (const [total, n] of [[1200.5, 7], [999.99, 4], [10, 3]] as const) {
      expect(Math.round(evenSchedule(total, n, d("2026-12-01"), "WEEK").reduce((s, r) => s + r.amount, 0) * 100) / 100).toBe(total);
    }
  });

  it("spaces dates by the week, fortnight or month, and a month never spills past a shorter one", () => {
    expect(evenSchedule(300, 3, d("2026-12-01"), "WEEK").map((r) => iso(r.dueDate))).toEqual(["2026-12-01", "2026-12-08", "2026-12-15"]);
    expect(evenSchedule(300, 3, d("2026-12-01"), "TWO_WEEKS").map((r) => iso(r.dueDate))).toEqual(["2026-12-01", "2026-12-15", "2026-12-29"]);
    expect(evenSchedule(300, 4, d("2026-01-31"), "MONTH").map((r) => iso(r.dueDate))).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(iso(addMonthsUtc(d("2028-01-31"), 1))).toBe("2028-02-29"); // a leap year
    expect(iso(addMonthsUtc(d("2026-11-15"), 2))).toBe("2027-01-15"); // across the new year
  });
});

describe("SCHEDULE_REPLACE prepare", () => {
  it("builds the card from the server's split: each instalment, the total, and the confirmation", async () => {
    const out = await prepare({ dealId: "d1", even: { count: 3, firstDueDate: future(10), every: "MONTH" } });
    expect(out.preview.title).toBe("Set an instalment schedule");
    expect(line(out, "Customer")).toBe("Adaeze Okafor");
    expect(line(out, "Deal total")).toBe("1200.00 USD");
    expect(out.preview.lines.filter((l) => l.label.startsWith("No. ")).map((l) => l.value.split(": ")[1])).toEqual(["400.00 USD (open)", "400.00 USD (open)", "400.00 USD (open)"]);
    expect(line(out, "Scheduled")).toBe("1200.00 USD in 3 instalments");
    expect(out.preview.confirm).toMatchObject({ title: "Set this schedule?", button: "Set schedule" });
    expect(out.preview.warning).toBeUndefined();
    expect((out.params.instalments as unknown[]).length).toBe(3);
    expect(out.params.expect).toEqual({ paid: 0, scheduleKey: "" });
    expect(rs.replaceSchedule).not.toHaveBeenCalled();
  });

  it("shows what existing payments already cover, from the same oldest-first rule as the screens", async () => {
    view.dealPaymentsView.mockResolvedValue({ dealAmount: 1200, currency: "USD", summary: { paid: 500, balance: 700 }, instalments: [] });
    const out = await prepare({ dealId: "d1", even: { count: 3, firstDueDate: future(10), every: "WEEK" } });
    const values = out.preview.lines.filter((l) => l.label.startsWith("No. ")).map((l) => l.value.slice(l.value.indexOf(": ") + 2));
    expect(values).toEqual(["400.00 USD (already covered by payments)", "400.00 USD (part covered: 100.00 paid)", "400.00 USD (open)"]);
    expect(line(out, "Paid so far")).toBe("500.00 USD");
  });

  it("says it replaces an existing schedule, and that customers may be reminded again", async () => {
    view.dealPaymentsView.mockResolvedValue({ dealAmount: 1200, currency: "USD", summary: { paid: 0, balance: 1200 }, instalments: [{ id: "i1", position: 1, dueDate: d("2026-11-01"), amount: 600, covered: 0, overdue: false }, { id: "i2", position: 2, dueDate: d("2026-12-01"), amount: 600, covered: 0, overdue: false }] });
    const out = await prepare({ dealId: "d1", even: { count: 4, firstDueDate: future(10), every: "MONTH" } });
    expect(out.preview.title).toBe("Replace the instalment schedule");
    expect(out.preview.warning).toMatch(/replaces the current schedule of 2 instalments \(600.00, 600.00\)/);
    expect(out.preview.warning).toMatch(/reminders again/);
    expect(out.preview.confirm?.button).toBe("Replace schedule");
    expect(out.params.expect).toEqual({ paid: 0, scheduleKey: "2026-11-01:600.00|2026-12-01:600.00" });
  });

  it("takes a custom list as given, in date order, and warns when it does not cover the deal or is in the past", async () => {
    const out = await prepare({ dealId: "d1", custom: [{ dueDate: future(40), amount: 300 }, { dueDate: "2020-01-01", amount: 500 }] });
    expect(out.preview.lines.filter((l) => l.label.startsWith("No. ")).map((l) => l.value.split(" ")[1])).toEqual(["2020-01-01:", expect.stringContaining(future(40))]);
    expect(out.preview.warning).toMatch(/cover 800.00 of the 1200.00 USD deal; 400.00 is not scheduled/);
    expect(out.preview.warning).toMatch(/in the past/);
  });

  it("refuses: neither or both forms, a total above the deal, an invisible deal, a deal with no amount, too many", async () => {
    await expect(prepare({ dealId: "d1" })).rejects.toThrow(/either `even`/);
    await expect(prepare({ dealId: "d1", even: { count: 2, firstDueDate: future(5), every: "WEEK" }, custom: [{ dueDate: future(5), amount: 1 }] })).rejects.toThrow(/either `even`/);
    await expect(prepare({ dealId: "d1", custom: [{ dueDate: future(5), amount: 800 }, { dueDate: future(9), amount: 500 }] })).rejects.toThrow(/more than the deal amount of 1200.00 USD/);
    await expect(prepare({ dealId: "d1", even: { count: 25, firstDueDate: future(5), every: "WEEK" } })).rejects.toBeInstanceOf(ToolError);
    await expect(prepare({ dealId: "d1", even: { count: 1, firstDueDate: future(5), every: "WEEK" } })).rejects.toBeInstanceOf(ToolError);
    await expect(prepare({ dealId: "d1", custom: [{ dueDate: future(5), amount: 0 }] })).rejects.toBeInstanceOf(ToolError);
    db.deal.findFirst.mockResolvedValue({ ...deal, amount: "0" });
    await expect(prepare({ dealId: "d1", even: { count: 2, firstDueDate: future(5), every: "WEEK" } })).rejects.toThrow(/no amount yet/);
    db.deal.findFirst.mockResolvedValue(null);
    await expect(prepare({ dealId: "x", even: { count: 2, firstDueDate: future(5), every: "WEEK" } })).rejects.toThrow(/No deal with that id is visible/);
  });

  it("reads the deal through the person's own scope", async () => {
    await prepare({ dealId: "d1", even: { count: 2, firstDueDate: future(5), every: "WEEK" } });
    expect(db.deal.findFirst.mock.calls[0][0].where).toMatchObject({ id: "d1", tenantId: "t1", ownerId: "u-sales", deletedAt: null });
  });

  it("offers no editing: to change a schedule, decline and ask again", () => {
    expect(Object.keys((KINDS.SCHEDULE_REPLACE.edit as unknown as { shape: object }).shape)).toEqual([]);
  });
});

describe("SCHEDULE_REPLACE apply", () => {
  it("replaces it through the shared function, passing what the card expected", async () => {
    rs.replaceSchedule.mockResolvedValue({});
    const done = await KINDS.SCHEDULE_REPLACE.apply!(sales, { dealId: "d1", instalments: [{ dueDate: "2026-12-01", amount: 600 }, { dueDate: "2027-01-01", amount: 600 }], expect: { paid: 0, scheduleKey: "" } });
    expect(rs.replaceSchedule).toHaveBeenCalledWith(sales, "d1", [{ dueDate: new Date("2026-12-01"), amount: 600 }, { dueDate: new Date("2027-01-01"), amount: 600 }], { expect: { paid: 0, scheduleKey: "" } });
    expect(done).toEqual({ entity: "deal", id: "d1", href: "/deals/d1" });
  });

  it("checks the dates and amounts again before writing anything", async () => {
    await expect(KINDS.SCHEDULE_REPLACE.apply!(sales, { dealId: "d1", instalments: [{ dueDate: "soon", amount: 600 }], expect: { paid: 0, scheduleKey: "" } })).rejects.toBeInstanceOf(ToolError);
    expect(rs.replaceSchedule).not.toHaveBeenCalled();
  });
});
