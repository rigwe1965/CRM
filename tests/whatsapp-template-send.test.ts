import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, wa, cap, view } = vi.hoisted(() => ({
  db: {
    contact: { findFirst: vi.fn() },
    deal: { findFirst: vi.fn() },
    whatsappTemplate: { findFirst: vi.fn() },
    activity: { create: vi.fn() },
  },
  wa: { sendWhatsAppTemplate: vi.fn(), whatsappConfigured: vi.fn(), canReplyFreely: vi.fn() },
  cap: vi.fn(),
  view: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/whatsapp", () => wa);
vi.mock("@/lib/usage-limits", () => ({ assertUnderDailyCap: cap }));
vi.mock("@/lib/payments", () => ({ dealPaymentsView: view }));
vi.mock("@/lib/route", () => ({
  authed: (handler: (ctx: unknown) => Promise<Response>) => async (req: Request, context?: { params: Promise<unknown> }) => {
    try {
      return await handler({ req, user: { id: "u1", tenantId: "t1", role: "SALES", name: "Sam", email: "s@x.test" }, params: (await context?.params) ?? {} });
    } catch (e) {
      const err = e as { status?: number; code?: string; fieldErrors?: unknown };
      return new Response(JSON.stringify({ code: err.code, details: err.fieldErrors }), { status: err.status ?? 500 });
    }
  },
}));

import { POST } from "@/app/api/contacts/[id]/whatsapp/template/route";
import { GET as status } from "@/app/api/contacts/[id]/whatsapp/route";

const BODY = "Hi {{1}}, your instalment of {{2}} is due on {{3}}. Order: {{4}}";
const slots = [
  { label: "First name", source: "firstName" },
  { label: "Amount", source: "amountDue" },
  { label: "Date", source: "dueDate" },
  { label: "Order", source: "dealTitle" },
];
const template = (over: object = {}) => ({ id: "tpl1", name: "reminder", language: "en", body: BODY, status: "APPROVED", supported: true, active: true, slots, ...over });
const contact = (over: object = {}) => ({ id: "c1", firstName: "Ada", lastName: "Okafor", phoneE164: "+2348012345678", whatsappOptIn: true, ...over });
const call = (body: unknown) =>
  POST(new Request("http://x.test/api/contacts/c1/whatsapp/template", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: "c1" }) });
const bodyOf = async (res: Response) => (await res.json()) as { code?: string; details?: Record<string, string[]> };

beforeEach(() => {
  vi.clearAllMocks();
  wa.whatsappConfigured.mockResolvedValue(true);
  wa.sendWhatsAppTemplate.mockResolvedValue("wamid.1");
  db.contact.findFirst.mockResolvedValue(contact());
  db.whatsappTemplate.findFirst.mockResolvedValue(template());
  db.deal.findFirst.mockResolvedValue({ id: "d1", title: "Lace wig", amount: 300, currency: "USD" });
  db.activity.create.mockImplementation(async ({ data }) => ({ id: "a1", ...data }));
  view.mockResolvedValue({ currency: "USD", summary: { balance: 200, nextDue: { amount: 100, dueDate: new Date("2026-11-03T00:00:00Z") } } });
});

describe("POST /api/contacts/:id/whatsapp/template", () => {
  it("fills every blank, sends the template and logs the filled-in text", async () => {
    const res = await call({ templateId: "tpl1", dealId: "d1" });
    expect(res.status).toBe(201);
    expect(wa.sendWhatsAppTemplate).toHaveBeenCalledWith("t1", "+2348012345678", "reminder", "en", ["Ada", "$100.00", "2026-11-03", "Lace wig"]);
    expect(db.activity.create.mock.calls[0][0].data).toMatchObject({
      tenantId: "t1",
      type: "WHATSAPP",
      direction: "OUT",
      body: "Hi Ada, your instalment of $100.00 is due on 2026-11-03. Order: Lace wig",
      externalId: "wamid.1",
      contactId: "c1",
      dealId: "d1",
    });
    expect(cap).toHaveBeenCalledWith("t1", "whatsapp");
  });

  it("looks the contact, template and order up inside the caller's business and visibility", async () => {
    await call({ templateId: "tpl1", dealId: "d1" });
    expect(db.contact.findFirst.mock.calls[0][0].where).toMatchObject({ id: "c1", deletedAt: null });
    expect(db.whatsappTemplate.findFirst.mock.calls[0][0].where).toMatchObject({ id: "tpl1", tenantId: "t1", active: true, status: "APPROVED", supported: true });
    expect(db.deal.findFirst.mock.calls[0][0].where).toMatchObject({ id: "d1", contactId: "c1", deletedAt: null });
  });

  it("404s for a contact the caller cannot see, and sends nothing", async () => {
    db.contact.findFirst.mockResolvedValue(null);
    expect((await call({ templateId: "tpl1", dealId: "d1" })).status).toBe(404);
    expect(wa.sendWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it("refuses a customer who has not agreed to WhatsApp messages", async () => {
    db.contact.findFirst.mockResolvedValue(contact({ whatsappOptIn: false }));
    const res = await call({ templateId: "tpl1", dealId: "d1" });
    expect(res.status).toBe(422);
    expect((await bodyOf(res)).code).toBe("NOT_OPTED_IN");
    expect(wa.sendWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it("refuses a contact with no WhatsApp-ready number, and a business without WhatsApp", async () => {
    db.contact.findFirst.mockResolvedValue(contact({ phoneE164: null }));
    expect((await call({ templateId: "tpl1", dealId: "d1" })).status).toBe(422);
    db.contact.findFirst.mockResolvedValue(contact());
    wa.whatsappConfigured.mockResolvedValue(false);
    expect((await call({ templateId: "tpl1", dealId: "d1" })).status).toBe(409);
    expect(wa.sendWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it("404s for a template that is not approved, switched on and sendable", async () => {
    db.whatsappTemplate.findFirst.mockResolvedValue(null);
    expect((await call({ templateId: "tpl1", dealId: "d1" })).status).toBe(404);
    expect(wa.sendWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it("asks for the order when a blank needs one, and 404s for an order that is not this contact's", async () => {
    const res = await call({ templateId: "tpl1" });
    expect(res.status).toBe(422);
    expect((await bodyOf(res)).details).toHaveProperty("dealId");
    db.deal.findFirst.mockResolvedValue(null);
    expect((await call({ templateId: "tpl1", dealId: "other" })).status).toBe(404);
    expect(wa.sendWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it("refuses when nothing is owed or there is no due date, rather than sending a made-up value", async () => {
    view.mockResolvedValue({ currency: "USD", summary: { balance: 0, nextDue: null } });
    expect((await call({ templateId: "tpl1", dealId: "d1" })).status).toBe(422);
    view.mockResolvedValue({ currency: "USD", summary: { balance: 50, nextDue: null } });
    const res = await call({ templateId: "tpl1", dealId: "d1" });
    expect(res.status).toBe(422);
    expect((await bodyOf(res)).details).toHaveProperty("dealId");
    expect(wa.sendWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it("uses typed values for hand-filled blanks and names the one that is missing", async () => {
    db.whatsappTemplate.findFirst.mockResolvedValue(template({ body: "Hi {{1}}, tracking: {{2}}", slots: [slots[0], { label: "Tracking number", source: "trackingNumber" }] }));
    const missing = await call({ templateId: "tpl1", values: ["", "  "] });
    expect(missing.status).toBe(422);
    expect((await bodyOf(missing)).details).toHaveProperty("values.1");
    expect(wa.sendWhatsAppTemplate).not.toHaveBeenCalled();

    const res = await call({ templateId: "tpl1", values: ["", "  DHL  123 "] });
    expect(res.status).toBe(201);
    expect(wa.sendWhatsAppTemplate.mock.calls[0][4]).toEqual(["Ada", "DHL 123"]);
    expect(db.deal.findFirst).not.toHaveBeenCalled(); // no order needed when no blank uses one
  });

  it("fills the tracking number from the chosen order, ignoring anything typed", async () => {
    db.whatsappTemplate.findFirst.mockResolvedValue(template({ body: "Hi {{1}}, tracking: {{2}}", slots: [slots[0], { label: "Tracking number", source: "trackingNumber" }] }));
    db.deal.findFirst.mockResolvedValue({ id: "d1", title: "Lace wig", amount: 300, currency: "USD", trackingNumber: "JD0146" });
    const res = await call({ templateId: "tpl1", dealId: "d1", values: ["", "typed-by-mistake"] });
    expect(res.status).toBe(201);
    expect(wa.sendWhatsAppTemplate.mock.calls[0][4]).toEqual(["Ada", "JD0146"]);
    expect(db.deal.findFirst.mock.calls[0][0].where).toMatchObject({ id: "d1", contactId: "c1", deletedAt: null });
  });

  it("falls back to a typed tracking number when the order has none, and names the blank when both are missing", async () => {
    db.whatsappTemplate.findFirst.mockResolvedValue(template({ body: "Hi {{1}}, tracking: {{2}}", slots: [slots[0], { label: "Tracking number", source: "trackingNumber" }] }));
    db.deal.findFirst.mockResolvedValue({ id: "d1", title: "Lace wig", amount: 300, currency: "USD", trackingNumber: null });
    const missing = await call({ templateId: "tpl1", dealId: "d1" });
    expect(missing.status).toBe(422);
    expect((await bodyOf(missing)).details).toHaveProperty("values.1");
    expect(wa.sendWhatsAppTemplate).not.toHaveBeenCalled();
    expect((await call({ templateId: "tpl1", dealId: "d1", values: ["", "DHL 9"] })).status).toBe(201);
    expect(wa.sendWhatsAppTemplate.mock.calls[0][4]).toEqual(["Ada", "DHL 9"]);
  });

  it("passes on Meta's reason and logs nothing when Meta refuses", async () => {
    wa.sendWhatsAppTemplate.mockRejectedValue(new Error("Template name does not exist in the translation"));
    const res = await call({ templateId: "tpl1", dealId: "d1" });
    expect(res.status).toBe(502);
    expect(db.activity.create).not.toHaveBeenCalled();
  });
});

describe("GET /api/contacts/:id/whatsapp (what the contact page may offer)", () => {
  const get = async () => ((await (await status(new Request("http://x.test"), { params: Promise.resolve({ id: "c1" }) })).json()) as { data: { configured: boolean; canSend: boolean; canTemplate: boolean } }).data;

  it("offers a template, but not free text, to an opted-in contact outside the 24 hours", async () => {
    wa.canReplyFreely.mockResolvedValue(false);
    expect(await get()).toEqual({ configured: true, canSend: false, canTemplate: true });
  });

  it("offers both inside the 24 hours", async () => {
    wa.canReplyFreely.mockResolvedValue(true);
    expect(await get()).toMatchObject({ canSend: true, canTemplate: true });
  });

  it("offers no template without the opt-in, a number, or WhatsApp set up", async () => {
    wa.canReplyFreely.mockResolvedValue(false);
    db.contact.findFirst.mockResolvedValue(contact({ whatsappOptIn: false }));
    expect((await get()).canTemplate).toBe(false);
    db.contact.findFirst.mockResolvedValue(contact({ phoneE164: null }));
    expect((await get()).canTemplate).toBe(false);
    db.contact.findFirst.mockResolvedValue(contact());
    wa.whatsappConfigured.mockResolvedValue(false);
    expect(await get()).toEqual({ configured: false, canSend: false, canTemplate: false });
  });
});
