import { describe, expect, it } from "vitest";
import { dealStageEmail, instalmentReminderEmail, oneLine, taskReminderEmail } from "@/lib/email-templates";

const single = (s: string) => !/[\r\n]/.test(s);
const due = new Date("2026-10-10T00:00:00Z");

describe("oneLine", () => {
  it("collapses newlines, tabs and control characters", () => {
    expect(oneLine("a\nb\r\nc\td\u0000e")).toBe("a b c d e");
    expect(oneLine("  spaced   out  ")).toBe("spaced out");
  });
});

describe("email subjects built from user text", () => {
  it("deal stage subject stays on one line", () => {
    const m = dealStageEmail({ dealId: "d", title: "Wig\nBcc: x@evil.test", amount: 10, currency: "USD", from: "QUALIFICATION", to: "PROPOSAL", actorName: "A" });
    expect(single(m.subject)).toBe(true);
    expect(m.subject).toContain("Wig Bcc: x@evil.test");
  });
  it("task reminder subject stays on one line", () => {
    const m = taskReminderEmail("Sam", [{ title: "Call\r\nback", dueDate: due, overdue: false }]);
    expect(single(m.subject)).toBe(true);
  });
  it("instalment reminder subject stays on one line", () => {
    const m = instalmentReminderEmail("Sam", [{ customer: "Ada\nLovelace", dueDate: due, amountDue: 5, currency: "USD", overdue: true }]);
    expect(single(m.subject)).toBe(true);
  });
});
