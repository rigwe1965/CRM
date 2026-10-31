import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, getIntegration } = vi.hoisted(() => ({
  db: { whatsappTemplate: { findMany: vi.fn(), findFirst: vi.fn(), findFirstOrThrow: vi.fn(), create: vi.fn(), updateMany: vi.fn() } },
  getIntegration: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/integrations", () => ({ getIntegration }));
vi.mock("@/lib/route", () => ({
  authed: (handler: (ctx: unknown) => Promise<Response>, ...roles: string[]) => async (req: Request, context?: { params: Promise<unknown> }) => {
    try {
      const role = req.headers.get("x-test-role") ?? "ADMIN";
      if (roles.length && role !== "ADMIN" && !roles.includes(role)) return new Response(null, { status: 403 });
      return await handler({ req, user: { id: "u1", tenantId: "t1", role, name: "Boss", email: "b@x.test" }, params: (await context?.params) ?? {} });
    } catch (e) {
      const err = e as { status?: number; code?: string };
      return new Response(JSON.stringify({ code: err.code }), { status: err.status ?? 500 });
    }
  },
}));

import { PATCH } from "@/app/api/whatsapp-templates/[id]/route";
import { POST as SYNC } from "@/app/api/whatsapp-templates/sync/route";
import { defaultSlots, hasContiguousPlaceholders, placeholderNumbers, readSlots, renderBody } from "@/lib/whatsapp-template-slots";
import { mapMetaTemplate, syncWhatsappTemplates } from "@/lib/whatsapp-templates";

const BODY = "Hi {{1}}, your instalment of {{2}} is due on {{3}}.";
const meta = (over: object = {}) => ({ id: "m1", name: "payment_reminder_upcoming", language: "en", category: "UTILITY", status: "APPROVED", components: [{ type: "BODY", text: BODY }], ...over });
const row = (over: object = {}) => ({ id: "r1", tenantId: "t1", name: "payment_reminder_upcoming", language: "en", body: BODY, status: "APPROVED", supported: true, active: true, slots: defaultSlots(BODY), ...over });
const settings = (over: object = {}) => ({ settings: { accessToken: "tok-1234567890", phoneNumberId: "123456", appSecret: "s", verifyToken: "v", businessAccountId: "99999", ...over }, source: "settings" });
const patch = (body: unknown, role?: string) =>
  new Request("http://x.test/api/whatsapp-templates/r1", { method: "PATCH", headers: { "Content-Type": "application/json", ...(role ? { "x-test-role": role } : {}) }, body: JSON.stringify(body) });
const ctx = { params: Promise.resolve({ id: "r1" }) };

const metaReply = (data: unknown[], next?: string) => ({ ok: true, status: 200, json: async () => ({ data, paging: next ? { next } : undefined }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("template blanks", () => {
  it("finds the numbered blanks once, in order", () => {
    expect(placeholderNumbers("Hi {{1}}, {{2}} and {{ 1 }} again")).toEqual([1, 2]);
    expect(placeholderNumbers("No blanks")).toEqual([]);
  });

  it("wants the blanks numbered 1..n with no gaps", () => {
    expect(hasContiguousPlaceholders("{{1}} {{2}}")).toBe(true);
    expect(hasContiguousPlaceholders("{{1}} {{3}}")).toBe(false);
  });

  it("repairs stored slots that are missing, short or from an unknown source", () => {
    expect(readSlots(null, "Hi {{1}} {{2}}")).toEqual([
      { label: "Value 1", source: "manual" },
      { label: "Value 2", source: "manual" },
    ]);
    expect(readSlots([{ label: "Name", source: "firstName" }, { label: "", source: "nonsense" }], "{{1}} {{2}}")).toEqual([
      { label: "Name", source: "firstName" },
      { label: "Value 2", source: "manual" },
    ]);
  });

  it("fills a preview and leaves a missing value as its blank", () => {
    expect(renderBody("Hi {{1}}, {{2}}", ["Ada"])).toBe("Hi Ada, {{2}}");
  });
});

describe("mapMetaTemplate", () => {
  it("maps an approved text template", () => {
    expect(mapMetaTemplate(meta())).toMatchObject({ name: "payment_reminder_upcoming", language: "en", status: "APPROVED", supported: true, body: BODY, metaId: "m1" });
  });

  it("skips a template with no text body", () => {
    expect(mapMetaTemplate(meta({ components: [{ type: "HEADER", format: "IMAGE" }] }))).toBeNull();
  });

  it("marks media headers, variable buttons and named blanks as not sendable", () => {
    expect(mapMetaTemplate(meta({ components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: BODY }] }))?.supported).toBe(false);
    expect(mapMetaTemplate(meta({ components: [{ type: "BODY", text: BODY }, { type: "BUTTONS", buttons: [{ type: "URL", url: "https://x.test/{{1}}" }] }] }))?.supported).toBe(false);
    expect(mapMetaTemplate(meta({ components: [{ type: "BODY", text: "Hi {{first_name}}" }] }))?.supported).toBe(false);
  });
});

describe("syncWhatsappTemplates", () => {
  it("refuses when WhatsApp is not set up", async () => {
    getIntegration.mockResolvedValue(null);
    await expect(syncWhatsappTemplates("t1")).rejects.toMatchObject({ status: 409, code: "NOT_CONFIGURED" });
  });

  it("asks for the Business Account ID when it is missing", async () => {
    getIntegration.mockResolvedValue(settings({ businessAccountId: undefined }));
    await expect(syncWhatsappTemplates("t1")).rejects.toMatchObject({ status: 409, code: "NO_BUSINESS_ACCOUNT" });
  });

  it("passes on Meta's reason when it refuses", async () => {
    getIntegration.mockResolvedValue(settings());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { message: "Invalid OAuth access token" } }) }));
    await expect(syncWhatsappTemplates("t1")).rejects.toMatchObject({ status: 502, message: "Invalid OAuth access token" });
  });

  it("creates new templates (on only when approved), keeps the admin's choices on existing ones and retires missing ones", async () => {
    getIntegration.mockResolvedValue(settings());
    const fetchMock = vi.fn().mockResolvedValueOnce(metaReply([meta(), meta({ id: "m2", name: "brand_new", status: "PENDING" })], "https://graph.facebook.com/next")).mockResolvedValueOnce(metaReply([meta({ id: "m3", name: "second_page" })]));
    vi.stubGlobal("fetch", fetchMock);
    const custom = [{ label: "Customer", source: "fullName" }, ...defaultSlots(BODY).slice(1)];
    db.whatsappTemplate.findMany.mockResolvedValue([row({ slots: custom, active: false }), row({ id: "r9", name: "gone", language: "en" })]);

    const result = await syncWhatsappTemplates("t1");

    expect(result).toEqual({ created: 2, updated: 1, removed: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers.Authorization).toBe("Bearer tok-1234567890");
    const created = db.whatsappTemplate.create.mock.calls.map((c) => c[0].data);
    expect(created.find((d) => d.name === "brand_new")).toMatchObject({ tenantId: "t1", status: "PENDING", active: false });
    expect(created.find((d) => d.name === "second_page")).toMatchObject({ status: "APPROVED", active: true });
    const updates = db.whatsappTemplate.updateMany.mock.calls.map((c) => c[0]);
    const kept = updates.find((u) => u.where.id === "r1");
    expect(kept.data.slots).toEqual(custom);
    expect(kept.data.active).toBe(false); // the admin had switched it off; Meta approving does not switch it back on
    expect(updates.find((u) => u.where.id === "r9")).toMatchObject({ where: { tenantId: "t1" }, data: { status: "REMOVED", active: false } });
  });

  it("resets the slots when the number of blanks changed, and switches off a template Meta paused", async () => {
    getIntegration.mockResolvedValue(settings());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(metaReply([meta({ status: "PAUSED", components: [{ type: "BODY", text: "Hi {{1}}" }] })])));
    db.whatsappTemplate.findMany.mockResolvedValue([row()]);
    await syncWhatsappTemplates("t1");
    const { data } = db.whatsappTemplate.updateMany.mock.calls[0][0];
    expect(data.slots).toEqual(defaultSlots("Hi {{1}}"));
    expect(data.active).toBe(false);
  });
});

describe("routes", () => {
  it("only admins can copy from Meta or change a template", async () => {
    expect((await SYNC(new Request("http://x.test/s", { method: "POST", headers: { "x-test-role": "SALES" } }), { params: Promise.resolve({}) })).status).toBe(403);
    expect((await PATCH(patch({ active: false }, "SALES"), ctx)).status).toBe(403);
  });

  it("answers 404 for a template of another business", async () => {
    db.whatsappTemplate.findFirst.mockResolvedValue(null);
    expect((await PATCH(patch({ active: false }), ctx)).status).toBe(404);
    expect(db.whatsappTemplate.findFirst.mock.calls[0][0].where).toMatchObject({ id: "r1", tenantId: "t1" });
    expect(db.whatsappTemplate.updateMany).not.toHaveBeenCalled();
  });

  it("will not switch on a template Meta has not approved or the CRM cannot send", async () => {
    db.whatsappTemplate.findFirst.mockResolvedValue(row({ status: "PENDING", active: false }));
    expect((await PATCH(patch({ active: true }), ctx)).status).toBe(409);
    db.whatsappTemplate.findFirst.mockResolvedValue(row({ supported: false, active: false }));
    expect((await PATCH(patch({ active: true }), ctx)).status).toBe(409);
    expect(db.whatsappTemplate.updateMany).not.toHaveBeenCalled();
  });

  it("refuses slots that do not match the number of blanks", async () => {
    db.whatsappTemplate.findFirst.mockResolvedValue(row());
    expect((await PATCH(patch({ slots: [{ label: "Name", source: "firstName" }] }), ctx)).status).toBe(422);
    expect(db.whatsappTemplate.updateMany).not.toHaveBeenCalled();
  });

  it("saves slots for an approved template", async () => {
    db.whatsappTemplate.findFirst.mockResolvedValue(row());
    db.whatsappTemplate.findFirstOrThrow.mockResolvedValue(row({ lastSyncedAt: new Date("2026-11-01") }));
    const slots = [{ label: "Name", source: "firstName" }, { label: "Amount", source: "amountDue" }, { label: "Date", source: "dueDate" }];
    const res = await PATCH(patch({ slots }), ctx);
    expect(res.status).toBe(200);
    expect(db.whatsappTemplate.updateMany).toHaveBeenCalledWith({ where: { id: "r1", tenantId: "t1" }, data: { slots } });
  });
});
