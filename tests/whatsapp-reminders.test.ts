import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, audit, payLink, orderLink, sendTemplate, configured, cap, integration } = vi.hoisted(() => ({
  db: {
    tenant: { findFirst: vi.fn(async () => ({ name: "Test Co", brandName: null })) },
    automationSetting: { findUnique: vi.fn() },
    instalment: { findMany: vi.fn(), findFirst: vi.fn() },
    instalmentReminder: { create: vi.fn(), upsert: vi.fn(), findMany: vi.fn() },
    activity: { create: vi.fn() },
    task: { findFirst: vi.fn(), create: vi.fn() },
  },
  audit: vi.fn(),
  payLink: vi.fn(),
  orderLink: vi.fn(),
  sendTemplate: vi.fn(),
  configured: vi.fn(),
  cap: vi.fn(),
  integration: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/audit", () => ({ audit }));
vi.mock("@/lib/payment-links", () => ({ reminderPayLink: payLink }));
vi.mock("@/lib/order-links", () => ({ reminderOrderLink: orderLink }));
vi.mock("@/lib/usage-limits", () => ({ assertUnderDailyCap: cap }));
vi.mock("@/lib/whatsapp", async (orig) => ({ ...(await orig<typeof import("@/lib/whatsapp")>()), sendWhatsAppTemplate: sendTemplate, whatsappConfigured: configured }));
vi.mock("@/lib/integrations", () => ({ getIntegration: integration }));

import { DEFAULT_INSTALMENT_EMAILS, instalmentEmailsSchema, resolveInstalmentEmails } from "@/lib/automations/config";
import { PAY_LINK_PREVIEW, planInstalmentWhatsapps, runInstalmentWhatsapps, sendReminderNow, whatsappParams } from "@/lib/automations/instalment-emails";
import { loadInstalmentEmails } from "@/lib/automations/settings";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const NOW = new Date("2026-11-10T08:00:00Z");

const wa = { enabled: true, language: "en", testPhone: "+2348000000001", templates: { UPCOMING: "t_up", OVERDUE_1: "t_o1", OVERDUE_2: "t_o2" } };
const saved = (over: object) => db.automationSetting.findUnique.mockResolvedValue({ key: "instalment-emails", config: { enabled: false, brandName: "Ivycandy Hair", ...over } });
const live = (w: object = {}) => saved({ mode: "LIVE", whatsapp: { ...wa, ...w } });
const test = (w: object = {}) => saved({ mode: "TEST", testEmail: "boss@example.com", whatsapp: { ...wa, ...w } });

// A $300 deal in three $100 instalments; i1 is 7 days late on NOW (second overdue notice).
const row = (over: Record<string, unknown> = {}, contactOver: Record<string, unknown> = {}) => ({
  id: "i1",
  dueDate: d("2026-11-03"),
  reminders: [],
  deal: {
    id: "d1", title: "Adaeze order", amount: 300, currency: "USD", stage: "NEGOTIATION", ownerId: "owner1", owner: { email: "sam@shop.test" }, contactId: "c1",
    contact: { firstName: "Adaeze", lastName: "Okafor", email: "ada@customer.test", emailOptOut: false, phoneE164: "+2348012345678", whatsappOptIn: true, deletedAt: null, ...contactOver },
    payments: [],
    instalments: [
      { id: "i1", position: 1, dueDate: d("2026-11-03"), amount: 100 },
      { id: "i2", position: 2, dueDate: d("2026-12-03"), amount: 100 },
      { id: "i3", position: 3, dueDate: d("2027-01-03"), amount: 100 },
    ],
  },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.automationSetting.findUnique.mockResolvedValue(null);
  db.instalment.findMany.mockResolvedValue([row()]);
  db.instalment.findFirst.mockResolvedValue(row());
  db.task.findFirst.mockResolvedValue(null);
  sendTemplate.mockResolvedValue("wamid.1");
  configured.mockResolvedValue(true);
  cap.mockResolvedValue(undefined);
  payLink.mockResolvedValue("https://pay.test/l/1");
  orderLink.mockResolvedValue(null);
});

describe("WhatsApp reminder settings", () => {
  it("is off by default and an older saved setting stays off", () => {
    expect(DEFAULT_INSTALMENT_EMAILS.whatsapp.enabled).toBe(false);
    expect(resolveInstalmentEmails({ enabled: true, mode: "LIVE", brandName: "Shop" }).whatsapp).toEqual(DEFAULT_INSTALMENT_EMAILS.whatsapp);
  });

  it("needs a test number in test mode, a valid language and Meta-style template names", () => {
    const base = { ...DEFAULT_INSTALMENT_EMAILS, mode: "TEST" as const, testEmail: "me@example.com" };
    const withWa = (w: object) => instalmentEmailsSchema.safeParse({ ...base, whatsapp: { ...base.whatsapp, enabled: true, ...w } }).success;
    expect(withWa({})).toBe(false); // test mode, no number
    expect(withWa({ testPhone: "+2348012345678" })).toBe(true);
    expect(withWa({ testPhone: "08012345678" })).toBe(false);
    expect(withWa({ testPhone: "+2348012345678", language: "english" })).toBe(false);
    expect(withWa({ testPhone: "+2348012345678", language: "en_GB" })).toBe(true);
    expect(withWa({ testPhone: "+2348012345678", templates: { ...base.whatsapp.templates, UPCOMING: "Has Spaces" } })).toBe(false);
  });
});

describe("template parameters", () => {
  it("are first name, amount, due date and the pay link, or a reply line when there is no link", () => {
    const p = { firstName: "Ada", amountDue: 100, currency: "USD", dueDate: d("2026-11-03") };
    expect(whatsappParams(p, "https://pay.test/x")).toEqual(["Ada", "$100.00", "2026-11-03", "https://pay.test/x"]);
    expect(whatsappParams(p)[3]).toBe("just reply to this message");
  });
});

describe("the daily WhatsApp run", () => {
  it("does nothing while off, or when WhatsApp is not set up", async () => {
    expect(await runInstalmentWhatsapps("t1", NOW)).toMatchObject({ sent: 0 });
    live({ enabled: false });
    expect(await runInstalmentWhatsapps("t1", NOW)).toMatchObject({ sent: 0 });
    live();
    configured.mockResolvedValue(false);
    expect(await runInstalmentWhatsapps("t1", NOW)).toMatchObject({ sent: 0 });
    expect(db.instalment.findMany).not.toHaveBeenCalled();
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it("asks only for customers who opted in and have a number, and tracks WhatsApp reminders on their own", async () => {
    live();
    await planInstalmentWhatsapps("t1", await loadInstalmentEmails("t1"), NOW);
    const q = db.instalment.findMany.mock.calls[0][0];
    expect(q.where.tenantId).toBe("t1");
    expect(q.where.deal.contact).toEqual({ deletedAt: null, phoneE164: { not: null }, whatsappOptIn: true });
    expect(q.select.reminders.where).toEqual({ test: false, channel: "WHATSAPP" });
  });

  it("live: sends the notice's template to the customer, records it, logs it and makes the call task", async () => {
    live();
    expect(await runInstalmentWhatsapps("t1", NOW)).toMatchObject({ sent: 1, failed: 0, tasks: 1, test: false });
    expect(sendTemplate).toHaveBeenCalledWith("t1", "+2348012345678", "t_o2", "en", ["Adaeze", "$100.00", "2026-11-03", "https://pay.test/l/1"]);
    expect(db.instalmentReminder.create).toHaveBeenCalledWith({
      data: { tenantId: "t1", instalmentId: "i1", kind: "OVERDUE_2", test: false, channel: "WHATSAPP", recipient: "+2348012345678" },
    });
    expect(db.activity.create.mock.calls[0][0].data).toMatchObject({ tenantId: "t1", type: "WHATSAPP", direction: "OUT", contactId: "c1", dealId: "d1", externalId: "wamid.1" });
    expect(db.task.create).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith({ email: "automation", tenantId: "t1" }, expect.objectContaining({ action: "automation.instalment_whatsapps" }));
  });

  it("live: sends the customer's order page as the link when there is one, instead of a Stripe link", async () => {
    live();
    orderLink.mockResolvedValue("https://crm.test/my-order/abc");
    await runInstalmentWhatsapps("t1", NOW);
    expect(sendTemplate).toHaveBeenCalledWith("t1", "+2348012345678", "t_o2", "en", ["Adaeze", "$100.00", "2026-11-03", "https://crm.test/my-order/abc"]);
    expect(payLink).not.toHaveBeenCalled();
  });

  it("test mode: goes to the test number with a placeholder link and changes nothing about the customer", async () => {
    test();
    expect(await runInstalmentWhatsapps("t1", NOW)).toMatchObject({ sent: 1, tasks: 0, test: true });
    expect(sendTemplate).toHaveBeenCalledWith("t1", "+2348000000001", "t_o2", "en", expect.arrayContaining([PAY_LINK_PREVIEW]));
    expect(payLink).not.toHaveBeenCalled();
    expect(db.instalmentReminder.create.mock.calls[0][0].data).toMatchObject({ test: true, channel: "WHATSAPP", recipient: "+2348000000001" });
    expect(db.activity.create).not.toHaveBeenCalled();
    expect(db.task.create).not.toHaveBeenCalled();
  });

  it("records nothing when Meta refuses, so the next run retries", async () => {
    live();
    sendTemplate.mockRejectedValue(new Error("Template not approved"));
    expect(await runInstalmentWhatsapps("t1", NOW)).toMatchObject({ sent: 0, failed: 1 });
    expect(db.instalmentReminder.create).not.toHaveBeenCalled();
    expect(db.activity.create).not.toHaveBeenCalled();
  });

  it("stops quietly when the plan's daily WhatsApp allowance is used up", async () => {
    live();
    cap.mockRejectedValue(Object.assign(new Error("cap"), { code: "USAGE_LIMIT" }));
    expect(await runInstalmentWhatsapps("t1", NOW)).toMatchObject({ sent: 0, failed: 0 });
    expect(sendTemplate).not.toHaveBeenCalled();
  });
});

describe("sending a WhatsApp reminder now", () => {
  const user = { id: "u9", email: "sam@shop.test", tenantId: "t1" };

  it("sends the notice that matches how late it is and refreshes the WhatsApp record", async () => {
    live();
    expect(await sendReminderNow(user, "d1", "i1", NOW, "WHATSAPP")).toEqual({ kind: "OVERDUE_2", test: false, channel: "WHATSAPP", to: "+2348012345678" });
    expect(db.instalment.findFirst.mock.calls[0][0].select.reminders.where).toEqual({ test: false, channel: "WHATSAPP" });
    expect(db.instalmentReminder.upsert.mock.calls[0][0].where).toEqual({
      instalmentId_kind_test_channel: { instalmentId: "i1", kind: "OVERDUE_2", test: false, channel: "WHATSAPP" },
    });
    expect(db.task.create).not.toHaveBeenCalled();
  });

  it("goes to the test number in test mode, and refuses with no test number", async () => {
    test();
    expect((await sendReminderNow(user, "d1", "i1", NOW, "WHATSAPP")).to).toBe("+2348000000001");
    test({ testPhone: "" });
    await expect(sendReminderNow(user, "d1", "i1", NOW, "WHATSAPP")).rejects.toMatchObject({ status: 422, code: "REMINDERS_NOT_LIVE" });
  });

  it("refuses a customer who has not opted in, has no number, or a business without WhatsApp", async () => {
    live();
    db.instalment.findFirst.mockResolvedValue(row({}, { whatsappOptIn: false }));
    await expect(sendReminderNow(user, "d1", "i1", NOW, "WHATSAPP")).rejects.toMatchObject({ status: 422, code: "NOT_OPTED_IN" });
    db.instalment.findFirst.mockResolvedValue(row({}, { phoneE164: null }));
    await expect(sendReminderNow(user, "d1", "i1", NOW, "WHATSAPP")).rejects.toMatchObject({ status: 422, code: "NO_PHONE" });
    configured.mockResolvedValue(false);
    await expect(sendReminderNow(user, "d1", "i1", NOW, "WHATSAPP")).rejects.toMatchObject({ status: 409, code: "NOT_CONFIGURED" });
    expect(sendTemplate).not.toHaveBeenCalled();
  });
});

describe("sendWhatsAppTemplate", () => {
  it("posts Meta's template payload with cleaned parameters and returns the message id", async () => {
    const real = await vi.importActual<typeof import("@/lib/whatsapp")>("@/lib/whatsapp");
    integration.mockResolvedValue({ settings: { accessToken: "tok", phoneNumberId: "123" }, source: "settings" });
    const fetchMock = vi.fn(async (_url: string, _init: { body: string; headers: Record<string, string> }) => new Response(JSON.stringify({ messages: [{ id: "wamid.9" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const id = await real.sendWhatsAppTemplate("t1", "+234 801 234 5678", "t_o1", "en", ["Ada\nOkafor", "", "$100.00"]);
    expect(id).toBe("wamid.9");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/123/messages");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: "whatsapp",
      to: "2348012345678",
      type: "template",
      template: { name: "t_o1", language: { code: "en" }, components: [{ type: "body", parameters: [{ type: "text", text: "Ada Okafor" }, { type: "text", text: "-" }, { type: "text", text: "$100.00" }] }] },
    });
    vi.unstubAllGlobals();
  });

  it("throws with Meta's reason when it refuses", async () => {
    const real = await vi.importActual<typeof import("@/lib/whatsapp")>("@/lib/whatsapp");
    integration.mockResolvedValue({ settings: { accessToken: "tok", phoneNumberId: "123" }, source: "settings" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Template name does not exist" } }), { status: 400 })));
    await expect(real.sendWhatsAppTemplate("t1", "+2348012345678", "nope", "en", [])).rejects.toThrow("Template name does not exist");
    integration.mockResolvedValue(null);
    await expect(real.sendWhatsAppTemplate("t1", "+2348012345678", "x", "en", [])).rejects.toThrow("not set up");
    vi.unstubAllGlobals();
  });
});
