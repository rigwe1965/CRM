import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
import { summarize } from "@/lib/payments";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const schedule = [
  { id: "b", position: 2, dueDate: d("2026-02-01"), amount: 100 },
  { id: "a", position: 1, dueDate: d("2026-01-01"), amount: 100 },
];

describe("summarize", () => {
  it("applies payments oldest-first regardless of input order", () => {
    const { instalments, summary } = summarize(200, 150, schedule, "2026-01-15");
    expect(instalments.map((i) => [i.id, i.covered])).toEqual([["a", 100], ["b", 50]]);
    expect(summary).toMatchObject({ paid: 150, balance: 50, overdue: false });
    expect(summary.nextDue?.amount).toBe(50);
  });

  it("is not overdue on the due date, but is the day after", () => {
    expect(summarize(200, 0, schedule, "2026-01-01").summary.overdue).toBe(false);
    expect(summarize(200, 0, schedule, "2026-01-02").summary.overdue).toBe(true);
  });

  it("covered instalments are never overdue", () => {
    expect(summarize(200, 100, schedule, "2026-01-20").summary.overdue).toBe(false);
  });

  it("handles no schedule", () => {
    const { summary } = summarize(500, 120, []);
    expect(summary).toEqual({ paid: 120, balance: 380, nextDue: null, overdue: false });
  });

  it("handles overpayment and float rounding", () => {
    expect(summarize(100, 130, schedule.slice(1)).summary.balance).toBe(-30);
    expect(summarize(0.3, 0.1, []).summary.balance).toBe(0.2);
  });
});
