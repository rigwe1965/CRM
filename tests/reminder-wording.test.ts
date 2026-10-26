import { describe, expect, it } from "vitest";
import { DEFAULT_INSTALMENT_EMAILS, instalmentEmailsSchema, resolveInstalmentEmails } from "@/lib/automations/config";
import { customerInstalmentEmail } from "@/lib/email-templates";

const base = {
  brand: "Ivycandy Hair",
  firstName: "Ada",
  dealTitle: "Bundle order",
  amountDue: 100,
  currency: "USD",
  dueDate: new Date("2026-11-10T00:00:00Z"),
  daysLate: 3,
  kind: "OVERDUE_1" as const,
};

describe("own reminder wording", () => {
  it("fills the placeholders in the subject and message, keeping the greeting, pay button and sign-off", () => {
    const m = customerInstalmentEmail({
      ...base,
      payUrl: "https://pay.test/x",
      wording: { subject: "{name}, {amount} for {deal}", message: "Due {dueDate}, {daysLate} days ago. Unknown {thing} stays." },
    });
    expect(m.subject).toBe("Ada, $100.00 for Bundle order");
    expect(m.text).toContain("Hi Ada,\n\nDue 2026-11-10, 3 days ago. Unknown {thing} stays.");
    expect(m.text).toContain("https://pay.test/x");
    expect(m.text).toContain("Thank you,\nIvycandy Hair");
    expect(m.html).toContain("Pay now");
  });

  it("keeps the built-in text for a blank part, and when nothing is set", () => {
    const builtIn = customerInstalmentEmail(base);
    expect(customerInstalmentEmail({ ...base, wording: { subject: "", message: "" } })).toEqual(builtIn);
    const subjectOnly = customerInstalmentEmail({ ...base, wording: { subject: "Hello", message: "" } });
    expect(subjectOnly.subject).toBe("Hello");
    expect(subjectOnly.text).toContain("We have not yet received your instalment");
  });

  it("escapes what an admin writes and keeps the subject on one line", () => {
    const m = customerInstalmentEmail({ ...base, firstName: "<b>Ada</b>", wording: { subject: "Hi {name}\r\nBcc: x@evil.test", message: "<script>x</script> {name}" } });
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
  });

  it("is saved per notice, and an older saved setting without it keeps the built-in wording", () => {
    expect(DEFAULT_INSTALMENT_EMAILS.wording.UPCOMING).toEqual({ subject: "", message: "" });
    const old = { enabled: true, mode: "LIVE", testEmail: "", brandName: "Shop", daysBefore: 1, firstOverdueDays: 2, secondOverdueDays: 9 };
    const r = resolveInstalmentEmails(old);
    expect(r).toMatchObject({ enabled: true, mode: "LIVE", brandName: "Shop", daysBefore: 1 });
    expect(r.wording).toEqual(DEFAULT_INSTALMENT_EMAILS.wording);
    const partial = resolveInstalmentEmails({ ...old, wording: { OVERDUE_2: { subject: "Last call", message: "Please pay." } } });
    expect(partial.wording.OVERDUE_2.subject).toBe("Last call");
    expect(partial.wording.UPCOMING).toEqual({ subject: "", message: "" });
  });

  it("refuses over-long wording", () => {
    const cfg = { ...DEFAULT_INSTALMENT_EMAILS, mode: "LIVE" as const };
    const long = (n: number) => "x".repeat(n);
    expect(instalmentEmailsSchema.safeParse({ ...cfg, wording: { ...cfg.wording, UPCOMING: { subject: long(151), message: "" } } }).success).toBe(false);
    expect(instalmentEmailsSchema.safeParse({ ...cfg, wording: { ...cfg.wording, UPCOMING: { subject: "", message: long(2001) } } }).success).toBe(false);
    expect(instalmentEmailsSchema.safeParse({ ...cfg, wording: { ...cfg.wording, UPCOMING: { subject: long(150), message: long(2000) } } }).success).toBe(true);
  });
});
