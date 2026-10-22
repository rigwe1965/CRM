import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, audit, send } = vi.hoisted(() => ({
  db: {
    automationSetting: { findUnique: vi.fn() },
    instalment: { findMany: vi.fn() },
    instalmentReminder: { create: vi.fn() },
    activity: { create: vi.fn() },
    task: { findFirst: vi.fn(), create: vi.fn() },
  },
  audit: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/audit", () => ({ audit }));
vi.mock("@/lib/mail", async (orig) => ({ ...(await orig<typeof import("@/lib/mail")>()), trySendMail: send }));

import { DEFAULT_INSTALMENT_EMAILS, instalmentEmailsSchema, resolveInstalmentEmails } from "@/lib/automations/config";
import { EMAIL_RUN_LIMIT, MAX_OVERDUE_DAYS, pickReminder, planInstalmentEmails, runInstalmentEmails } from "@/lib/automations/instalment-emails";
import { customerInstalmentEmail } from "@/lib/email-templates";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const NOW = new Date("2026-11-10T08:00:00Z");
const cfg = { daysBefore: 2, firstOverdueDays: 1, secondOverdueDays: 7 };
const pick = (due: string, sent: ("UPCOMING" | "OVERDUE_1" | "OVERDUE_2")[] = [], amountDue = 100, today = "2026-11-10") =>
  pickReminder({ dueDate: d(due), today: d(today), amountDue, config: cfg, sent });

describe("pickReminder", () => {
  it("sends the friendly reminder from two days before until the due date", () => {
    expect(pick("2026-11-13")).toBeNull(); // 3 days ahead: too early
    expect(pick("2026-11-12")).toBe("UPCOMING");
    expect(pick("2026-11-11")).toBe("UPCOMING");
    expect(pick("2026-11-10")).toBe("UPCOMING"); // due today is not overdue
  });

  it("waits for the grace days, then sends the first and second overdue notices", () => {
    expect(pick("2026-11-09")).toBe("OVERDUE_1"); // 1 day late
    expect(pick("2026-11-04")).toBe("OVERDUE_1"); // 6 days late
    expect(pick("2026-11-03")).toBe("OVERDUE_2"); // 7 days late
  });

  it("stops after 30 days and when nothing is owed", () => {
    expect(pick("2026-10-11")).toBe("OVERDUE_2"); // 30 days late
    expect(pick("2026-10-10")).toBeNull(); // 31 days late: left to people
    expect(MAX_OVERDUE_DAYS).toBe(30);
    expect(pick("2026-11-09", [], 0)).toBeNull();
  });

  it("never repeats a notice and never goes backwards", () => {
    expect(pick("2026-11-12", ["UPCOMING"])).toBeNull();
    expect(pick("2026-11-09", ["UPCOMING"])).toBe("OVERDUE_1");
    expect(pick("2026-11-09", ["OVERDUE_1"])).toBeNull();
    expect(pick("2026-11-03", ["OVERDUE_1"])).toBe("OVERDUE_2");
    expect(pick("2026-11-03", ["OVERDUE_2"])).toBeNull();
    expect(pick("2026-11-09", ["OVERDUE_2"])).toBeNull(); // a later notice already went out
  });

  it("after a gap in the daily run, sends only the right notice, not all of them", () => {
    expect(pick("2026-11-02")).toBe("OVERDUE_2"); // 8 days late and never reminded: one email, the second notice
    expect(pick("2026-11-02", ["OVERDUE_2"])).toBeNull();
  });
});

describe("config", () => {
  it("is off and in test mode by default", () => {
    expect(resolveInstalmentEmails(undefined)).toEqual(DEFAULT_INSTALMENT_EMAILS);
    expect(DEFAULT_INSTALMENT_EMAILS).toMatchObject({ enabled: false, mode: "TEST" });
  });

  it("needs a test address to be on in test mode, and a second notice after the first", () => {
    const base = { ...DEFAULT_INSTALMENT_EMAILS, enabled: true };
    expect(instalmentEmailsSchema.safeParse(base).success).toBe(false); // TEST with no address
    expect(instalmentEmailsSchema.safeParse({ ...base, testEmail: "me@example.com" }).success).toBe(true);
    expect(instalmentEmailsSchema.safeParse({ ...base, mode: "LIVE" }).success).toBe(true);
    expect(instalmentEmailsSchema.safeParse({ ...base, mode: "LIVE", firstOverdueDays: 7, secondOverdueDays: 7 }).success).toBe(false);
    expect(instalmentEmailsSchema.safeParse({ ...base, testEmail: "not an email" }).success).toBe(false);
  });

  it("falls back to the defaults for an invalid saved value", () => {
    expect(resolveInstalmentEmails({ enabled: true, mode: "TEST", testEmail: "" })).toEqual(DEFAULT_INSTALMENT_EMAILS);
  });
});

describe("customerInstalmentEmail", () => {
  const base = { brand: "Ivycandy Hair", firstName: "Adaeze", dealTitle: "Adaeze order", amountDue: 100, currency: "USD", dueDate: d("2026-11-12"), daysLate: 0 };

  it("writes three different notices that always leave room for 'already paid'", () => {
    const up = customerInstalmentEmail({ ...base, kind: "UPCOMING" });
    const o1 = customerInstalmentEmail({ ...base, kind: "OVERDUE_1", daysLate: 1 });
    const o2 = customerInstalmentEmail({ ...base, kind: "OVERDUE_2", daysLate: 8 });
    expect(up.subject).toBe("Payment reminder: $100.00 due 2026-11-12");
    expect(o1.subject).toBe("Your payment of $100.00 was due on 2026-11-12");
    expect(o2.subject).toBe("Second reminder: $100.00 is overdue");
    expect(o2.text).toContain("8 days overdue");
    for (const m of [up, o1, o2]) {
      expect(m.text).toMatch(/Hi Adaeze,/);
      expect(m.text).toMatch(/already paid/);
      expect(m.text).toMatch(/Ivycandy Hair$/);
      expect(m.subject).not.toMatch(/[\r\n]/);
    }
  });

  it("escapes what it shows and keeps the subject on one line", () => {
    const m = customerInstalmentEmail({ ...base, kind: "UPCOMING", firstName: "<b>Ada</b>", dealTitle: 'Order "A"\r\nBcc: x@evil.test' });
    expect(m.html).not.toContain("<b>Ada</b>");
    expect(m.html).toContain("&lt;b&gt;Ada&lt;/b&gt;");
    expect(m.subject).not.toMatch(/[\r\n]/);
  });

  it("shows the test note only when given", () => {
    expect(customerInstalmentEmail({ ...base, kind: "UPCOMING" }).text).not.toContain("TEST MODE");
    const t = customerInstalmentEmail({ ...base, kind: "UPCOMING", testNote: "This would have gone to Ada <a@x.test>." });
    expect(t.text.startsWith("[TEST MODE] This would have gone to Ada")).toBe(true);
    expect(t.html).toContain("[TEST MODE]");
  });
});

describe("running it", () => {
  const live = { enabled: true, mode: "LIVE" as const, testEmail: "", brandName: "Ivycandy Hair" };
  const test = { enabled: true, mode: "TEST" as const, testEmail: "boss@example.com", brandName: "Ivycandy Hair" };
  const saved = (config: unknown) => db.automationSetting.findUnique.mockResolvedValue({ key: "instalment-emails", config });

  // A $300 deal, three $100 instalments, nothing paid. The one due on 2026-11-03 is 7 days late on NOW.
  const row = (over: Record<string, unknown> = {}, dealOver: Record<string, unknown> = {}) => ({
    id: "i1",
    dueDate: d("2026-11-03"),
    reminders: [],
    deal: {
      id: "d1", title: "Adaeze order", amount: 300, currency: "USD", ownerId: "owner1", owner: { email: "sam@shop.test" }, contactId: "c1",
      contact: { firstName: "Adaeze", lastName: "Okafor", email: "ada@customer.test" },
      payments: [],
      instalments: [
        { id: "i1", position: 1, dueDate: d("2026-11-03"), amount: 100 },
        { id: "i2", position: 2, dueDate: d("2026-12-03"), amount: 100 },
        { id: "i3", position: 3, dueDate: d("2027-01-03"), amount: 100 },
      ],
      ...dealOver,
    },
    ...over,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    db.automationSetting.findUnique.mockResolvedValue(null);
    db.instalment.findMany.mockResolvedValue([row()]);
    db.task.findFirst.mockResolvedValue(null);
    send.mockResolvedValue(true);
  });

  it("does nothing while off", async () => {
    expect(await runInstalmentEmails("t1", NOW)).toMatchObject({ sent: 0 });
    expect(db.instalment.findMany).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("test mode: emails the test address only, and changes nothing about the customer or the deal", async () => {
    saved(test);
    expect(await runInstalmentEmails("t1", NOW)).toMatchObject({ sent: 1, failed: 0, tasks: 0, test: true });
    const mail = send.mock.calls[0][0];
    expect(mail.to).toBe("boss@example.com");
    expect(mail.subject).toBe("[TEST] Second reminder: $100.00 is overdue");
    expect(mail.text).toContain("This would have gone to Adaeze Okafor <ada@customer.test>");
    expect(JSON.stringify(mail)).not.toContain('"to":"ada@customer.test"');
    expect(db.instalmentReminder.create).toHaveBeenCalledWith({ data: { tenantId: "t1", instalmentId: "i1", kind: "OVERDUE_2", test: true, recipient: "boss@example.com" } });
    expect(db.activity.create).not.toHaveBeenCalled();
    expect(db.task.create).not.toHaveBeenCalled();
  });

  it("live mode: emails the customer, replies go to the owner, logs it, and after the second notice makes a call task", async () => {
    saved(live);
    expect(await runInstalmentEmails("t1", NOW)).toMatchObject({ sent: 1, tasks: 1, test: false });
    const mail = send.mock.calls[0][0];
    expect(mail).toMatchObject({ to: "ada@customer.test", replyTo: "sam@shop.test", from: expect.stringContaining('"Ivycandy Hair"') });
    expect(mail.subject).toBe("Second reminder: $100.00 is overdue");
    expect(db.instalmentReminder.create).toHaveBeenCalledWith({ data: { tenantId: "t1", instalmentId: "i1", kind: "OVERDUE_2", test: false, recipient: "ada@customer.test" } });
    expect(db.activity.create.mock.calls[0][0].data).toMatchObject({ tenantId: "t1", type: "EMAIL", authorId: "owner1", contactId: "c1", dealId: "d1" });
    expect(db.task.create.mock.calls[0][0].data).toMatchObject({
      title: "Call Adaeze Okafor: payment is overdue", priority: "HIGH", assigneeId: "owner1", automationKey: "overdue-call:i1",
    });
    expect(audit).toHaveBeenCalledWith({ email: "automation", tenantId: "t1" }, expect.objectContaining({ action: "automation.instalment_emails" }));
  });

  it("makes no second call task while one is open", async () => {
    saved(live);
    db.task.findFirst.mockResolvedValue({ id: "open" });
    expect(await runInstalmentEmails("t1", NOW)).toMatchObject({ sent: 1, tasks: 0 });
    expect(db.task.create).not.toHaveBeenCalled();
  });

  it("records nothing when the provider rejects the email, so the next run retries", async () => {
    saved(live);
    send.mockResolvedValue(false);
    expect(await runInstalmentEmails("t1", NOW)).toMatchObject({ sent: 0, failed: 1 });
    expect(db.instalmentReminder.create).not.toHaveBeenCalled();
    expect(db.activity.create).not.toHaveBeenCalled();
  });

  it("skips what was already sent, what is already paid, and instalments that are not due", async () => {
    saved(live);
    db.instalment.findMany.mockResolvedValue([
      row({ reminders: [{ kind: "OVERDUE_2" }] }), // already sent
      row({ id: "i1" }, { payments: [{ amount: 100 }] }), // paid in full
      row({ id: "i2", dueDate: d("2026-12-03") }), // not due for weeks
    ]);
    expect(await planInstalmentEmails("t1", { ...DEFAULT_INSTALMENT_EMAILS, ...live }, NOW)).toEqual([]);
    expect(await runInstalmentEmails("t1", NOW)).toMatchObject({ sent: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("asks only for live deals with a reachable contact, and looks at test and live reminders separately", async () => {
    await planInstalmentEmails("t1", { ...DEFAULT_INSTALMENT_EMAILS, ...test }, NOW);
    const q = db.instalment.findMany.mock.calls[0][0];
    expect(q.where.deal).toMatchObject({
      deletedAt: null,
      stage: { not: "CLOSED_LOST" },
      owner: { isActive: true },
      contact: { deletedAt: null, email: { not: null }, emailOptOut: false },
    });
    expect(q.select.reminders.where).toEqual({ test: true });
    await planInstalmentEmails("t1", { ...DEFAULT_INSTALMENT_EMAILS, ...live }, NOW);
    expect(db.instalment.findMany.mock.calls[1][0].select.reminders.where).toEqual({ test: false });
  });

  it("caps one run", async () => {
    saved(live);
    db.instalment.findMany.mockResolvedValue(Array.from({ length: EMAIL_RUN_LIMIT + 25 }, (_, n) => row({ id: `i${n}` }, { instalments: [{ id: `i${n}`, position: 1, dueDate: d("2026-11-03"), amount: 100 }], amount: 100 })));
    expect((await runInstalmentEmails("t1", NOW)).sent).toBe(EMAIL_RUN_LIMIT);
  });
});
