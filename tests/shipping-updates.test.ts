import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, load, configured, send } = vi.hoisted(() => ({
  db: {
    contact: { findFirst: vi.fn() },
    whatsappTemplate: { findFirst: vi.fn() },
    activity: { findFirst: vi.fn(), create: vi.fn() },
  },
  load: vi.fn(),
  configured: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/automations/settings", () => ({ loadShippingUpdates: load }));
vi.mock("@/lib/whatsapp", () => ({ whatsappConfigured: configured }));
vi.mock("@/lib/whatsapp-template-send", () => ({ sendTemplateMessage: send }));

import { runShippingUpdate } from "@/lib/automations/shipping-updates";
import { DEFAULT_SHIPPING_UPDATES, automationsUpdateSchema, resolveShippingUpdates, shippingUpdatesSchema } from "@/lib/automations/config";

const user = { id: "u1", tenantId: "t1", role: "SALES", name: "Sam", email: "s@x.test" } as Parameters<typeof runShippingUpdate>[0];
const deal = { id: "d1", contactId: "c1" };
const on = { enabled: true, shipped: { enabled: true, templateId: "tpl1" }, delivered: { enabled: true, templateId: "tpl2" } };
const contact = (over: object = {}) => ({ id: "c1", firstName: "Ada", lastName: "Okafor", phoneE164: "+2348012345678", whatsappOptIn: true, ...over });
const notes = () => db.activity.create.mock.calls.map((c) => c[0].data);

beforeEach(() => {
  vi.clearAllMocks();
  load.mockResolvedValue(on);
  configured.mockResolvedValue(true);
  db.contact.findFirst.mockResolvedValue(contact());
  db.whatsappTemplate.findFirst.mockResolvedValue({ id: "tpl1", name: "order_shipped", language: "en", body: "Hi {{1}}", slots: [] });
  db.activity.findFirst.mockResolvedValue(null);
  db.activity.create.mockResolvedValue({});
  send.mockResolvedValue({ id: "a1" });
});

describe("settings", () => {
  it("ships switched off", () => {
    expect(DEFAULT_SHIPPING_UPDATES.enabled).toBe(false);
    expect(resolveShippingUpdates(undefined)).toEqual(DEFAULT_SHIPPING_UPDATES);
    expect(resolveShippingUpdates("junk")).toEqual(DEFAULT_SHIPPING_UPDATES);
  });

  it("an older or partial saved setting keeps the defaults for what is missing", () => {
    expect(resolveShippingUpdates({ enabled: true, shipped: { enabled: false }, delivered: { enabled: true, templateId: "x" } })).toEqual({
      enabled: true,
      shipped: { enabled: false, templateId: "" },
      delivered: { enabled: true, templateId: "x" },
    });
    // A saved setting that would be invalid (on, but no template) falls back to everything off.
    expect(resolveShippingUpdates({ enabled: true })).toEqual(DEFAULT_SHIPPING_UPDATES);
  });

  it("a switched-on step must name a template", () => {
    expect(shippingUpdatesSchema.safeParse({ ...on, shipped: { enabled: true, templateId: "" } }).success).toBe(false);
    expect(shippingUpdatesSchema.safeParse({ ...on, shipped: { enabled: false, templateId: "" } }).success).toBe(true);
    expect(shippingUpdatesSchema.safeParse({ enabled: false, shipped: { enabled: true, templateId: "" }, delivered: { enabled: false, templateId: "" } }).success).toBe(true);
  });

  it("can be saved on its own", () => {
    expect(automationsUpdateSchema.safeParse({ shippingUpdates: on }).success).toBe(true);
  });
});

describe("runShippingUpdate", () => {
  it("sends the chosen template to an opted-in customer, once, tagged as automatic", async () => {
    expect(await runShippingUpdate(user, deal, "SHIPPED")).toBe("SENT");
    expect(send).toHaveBeenCalledTimes(1);
    const [, c, tpl, input] = send.mock.calls[0];
    expect(c).toMatchObject({ id: "c1", phoneE164: "+2348012345678" });
    expect(tpl.name).toBe("order_shipped");
    expect(input).toEqual({ dealId: "d1", subject: "Automatic shipped update: order_shipped" });
    expect(db.whatsappTemplate.findFirst.mock.calls[0][0].where).toMatchObject({ id: "tpl1", tenantId: "t1", active: true, status: "APPROVED", supported: true });
  });

  it("uses the Delivered template for a delivery", async () => {
    await runShippingUpdate(user, deal, "DELIVERED");
    expect(db.whatsappTemplate.findFirst.mock.calls[0][0].where.id).toBe("tpl2");
  });

  it("does nothing when the automation or that step is off, or for other statuses", async () => {
    load.mockResolvedValue({ ...on, enabled: false });
    expect(await runShippingUpdate(user, deal, "SHIPPED")).toBe("OFF");
    load.mockResolvedValue({ ...on, shipped: { enabled: false, templateId: "tpl1" } });
    expect(await runShippingUpdate(user, deal, "SHIPPED")).toBe("OFF");
    for (const s of ["NOT_STARTED", "PACKED", "RETURNED"] as const) expect(await runShippingUpdate(user, deal, s)).toBe("OFF");
    expect(send).not.toHaveBeenCalled();
    expect(db.activity.create).not.toHaveBeenCalled();
  });

  it("never messages a customer who has not agreed to WhatsApp, and leaves a note", async () => {
    db.contact.findFirst.mockResolvedValue(contact({ whatsappOptIn: false }));
    expect(await runShippingUpdate(user, deal, "SHIPPED")).toBe("SKIPPED");
    expect(send).not.toHaveBeenCalled();
    expect(notes()[0]).toMatchObject({ type: "NOTE", dealId: "d1", contactId: "c1", body: "The customer has not agreed to WhatsApp messages." });
  });

  it("notes a missing number, missing WhatsApp setup and a template that is no longer usable", async () => {
    db.contact.findFirst.mockResolvedValue(contact({ phoneE164: null }));
    await runShippingUpdate(user, deal, "SHIPPED");
    db.contact.findFirst.mockResolvedValue(contact());
    configured.mockResolvedValue(false);
    await runShippingUpdate(user, deal, "SHIPPED");
    configured.mockResolvedValue(true);
    db.whatsappTemplate.findFirst.mockResolvedValue(null);
    await runShippingUpdate(user, deal, "SHIPPED");
    expect(notes().map((n) => n.body)).toEqual(["The customer has no WhatsApp-ready phone number.", "WhatsApp is not set up.", expect.stringContaining("no longer approved")]);
    expect(send).not.toHaveBeenCalled();
  });

  it("does not repeat a step it already sent for this order", async () => {
    db.activity.findFirst.mockResolvedValue({ id: "earlier" });
    expect(await runShippingUpdate(user, deal, "SHIPPED")).toBe("SKIPPED");
    expect(db.activity.findFirst.mock.calls[0][0].where).toMatchObject({ tenantId: "t1", dealId: "d1", subject: "Automatic shipped update: order_shipped" });
    expect(send).not.toHaveBeenCalled();
  });

  it("never throws: a refused send becomes a note with the reason", async () => {
    send.mockRejectedValue(new Error("Fill in the tracking number, or save it on the order first."));
    expect(await runShippingUpdate(user, deal, "SHIPPED")).toBe("SKIPPED");
    expect(notes()[0]).toMatchObject({ type: "NOTE", subject: "Automatic shipped update not sent", body: expect.stringContaining("tracking number") });
  });

  it("does nothing for an order with no customer", async () => {
    expect(await runShippingUpdate(user, { id: "d1", contactId: null }, "SHIPPED")).toBe("SKIPPED");
    expect(send).not.toHaveBeenCalled();
  });
});
