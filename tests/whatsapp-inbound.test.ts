import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, audit, trySendMail, sendFetch } = vi.hoisted(() => ({
  db: {
    automationSetting: { findUnique: vi.fn() },
    user: { findFirst: vi.fn() },
    contact: { findFirst: vi.fn(), create: vi.fn() },
    activity: { findFirst: vi.fn(), create: vi.fn() },
    task: { findFirst: vi.fn(), create: vi.fn() },
    tenantIntegration: { findFirst: vi.fn(async () => null) }, // no saved settings: the original business uses the environment
  },
  audit: vi.fn(),
  trySendMail: vi.fn(async () => true),
  sendFetch: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/usage-limits", () => ({ assertUnderDailyCap: vi.fn() })); // the daily cap needs the database; tests/tenant-deletion.test.ts covers it
vi.mock("@/lib/audit", () => ({ audit }));
vi.mock("@/lib/plan-limits", () => ({ assertWithinPlan: vi.fn() }));
vi.mock("@/lib/mail", () => ({ trySendMail, appUrl: () => "https://crm.test" }));
vi.mock("@/lib/route", () => ({
  authed: (handler: (ctx: unknown) => Promise<Response>) => async (req: Request, context?: { params: Promise<unknown> }) => {
    try {
      return await handler({ req, user: { id: "u1", tenantId: "tenant_ivycandy", role: "ADMIN", name: "Boss", email: "b@x.test" }, params: (await context?.params) ?? {} });
    } catch (e) {
      const err = e as { status?: number; code?: string };
      return new Response(JSON.stringify({ code: err.code }), { status: err.status ?? 500 });
    }
  },
}));

import { GET as verify, POST as webhook } from "@/app/api/webhooks/whatsapp/route";
import { GET as status, POST as send } from "@/app/api/contacts/[id]/whatsapp/route";
import { parseInbound, validSignature } from "@/lib/whatsapp";

const SECRET = "app-secret";
const TOKEN = "verify-token-123456";
const payload = (over: object = {}) => ({
  entry: [{ changes: [{ value: { contacts: [{ wa_id: "4915906462275", profile: { name: "Ada Okafor" } }], messages: [{ id: "wamid.1", from: "4915906462275", timestamp: "1790000000", type: "text", text: { body: "Hi, price for 24 inch?" }, ...over }] } }] }],
});
const sign = (raw: string) => `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}`;
const hook = (body: unknown, signature?: string) => {
  const raw = JSON.stringify(body);
  return webhook(new Request("http://crm.test/api/webhooks/whatsapp", { method: "POST", headers: { "x-hub-signature-256": signature ?? sign(raw) }, body: raw }));
};
const id = { params: Promise.resolve({ id: "c1" }) };
const sendReq = (message: string) => new Request("http://x.test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) });

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(process.env, { WHATSAPP_ACCESS_TOKEN: "tok", WHATSAPP_PHONE_NUMBER_ID: "123", WHATSAPP_APP_SECRET: SECRET, WHATSAPP_VERIFY_TOKEN: TOKEN });
  vi.stubGlobal("fetch", sendFetch);
  db.activity.findFirst.mockResolvedValue(null);
  db.activity.create.mockResolvedValue({ id: "a1" });
  db.task.findFirst.mockResolvedValue(null);
  db.automationSetting.findUnique.mockResolvedValue(null);
  db.user.findFirst.mockResolvedValue({ id: "admin1", name: "Boss", email: "boss@x.test" });
});

describe("webhook set-up check and signature", () => {
  it("echoes Meta's challenge only for the right token", async () => {
    const url = (t: string) => new Request(`http://crm.test/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${t}&hub.challenge=777`);
    const ok = await verify(url(TOKEN));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("777");
    expect((await verify(url("wrong-token-000000"))).status).toBe(403);
  });

  it("checks the HMAC of the raw body", () => {
    expect(validSignature("{}", sign("{}"), SECRET)).toBe(true);
    expect(validSignature("{}", sign("{ }"), SECRET)).toBe(false);
    expect(validSignature("{}", null, SECRET)).toBe(false);
    expect(validSignature("{}", "sha256=zz", SECRET)).toBe(false);
  });

  it("rejects an unsigned or wrongly signed call and saves nothing", async () => {
    expect((await hook(payload(), "sha256=" + "0".repeat(64))).status).toBe(401);
    expect(db.activity.create).not.toHaveBeenCalled();
  });

  it("is off until all four settings exist", async () => {
    delete process.env.WHATSAPP_APP_SECRET;
    expect((await hook(payload())).status).toBe(401);
  });
});

describe("incoming messages", () => {
  it("reads text, buttons and media captions, and ignores status updates", () => {
    expect(parseInbound(payload())[0]).toMatchObject({ id: "wamid.1", from: "+4915906462275", name: "Ada Okafor", text: "Hi, price for 24 inch?" });
    expect(parseInbound(payload({ type: "image", text: undefined, image: { caption: "like this" } }))[0].text).toBe("[image] like this");
    expect(parseInbound({ entry: [{ changes: [{ value: { statuses: [{ id: "x", status: "read" }] } }] }] })).toEqual([]);
    expect(parseInbound("junk")).toEqual([]);
  });

  it("logs it on the existing contact (IN), makes one reply task, and creates no new contact", async () => {
    db.contact.findFirst.mockResolvedValue({ id: "c1", ownerId: "sales1", firstName: "Ada", lastName: "Okafor" });
    expect((await hook(payload())).status).toBe(200);
    expect(db.contact.findFirst.mock.calls[0][0].where).toMatchObject({ tenantId: "tenant_ivycandy", phoneE164: "+4915906462275", deletedAt: null });
    expect(db.contact.create).not.toHaveBeenCalled();
    expect(db.activity.create.mock.calls[0][0].data).toMatchObject({ tenantId: "tenant_ivycandy", type: "WHATSAPP", direction: "IN", externalId: "wamid.1", contactId: "c1", authorId: "sales1", body: "Hi, price for 24 inch?" });
    expect(db.task.create.mock.calls[0][0].data).toMatchObject({ assigneeId: "sales1", automationKey: "wa-reply:c1" });
    expect(trySendMail).not.toHaveBeenCalled();
  });

  it("does not pile up reply tasks while one is open", async () => {
    db.contact.findFirst.mockResolvedValue({ id: "c1", ownerId: "sales1", firstName: "Ada", lastName: "Okafor" });
    db.task.findFirst.mockResolvedValue({ id: "t1" });
    await hook(payload());
    expect(db.task.create).not.toHaveBeenCalled();
  });

  it("turns an unknown number into a WhatsApp lead for the default owner and tells them", async () => {
    db.contact.findFirst.mockResolvedValue(null);
    db.contact.create.mockResolvedValue({ id: "c2", ownerId: "admin1", firstName: "Ada", lastName: "Okafor" });
    await hook(payload());
    expect(db.contact.create.mock.calls[0][0].data).toMatchObject({ firstName: "Ada", lastName: "Okafor", phoneE164: "+4915906462275", type: "LEAD", source: "WhatsApp", ownerId: "admin1" });
    expect(trySendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "boss@x.test", subject: "New WhatsApp lead: Ada Okafor" }));
  });

  it("records a message only once, however many times Meta delivers it", async () => {
    db.activity.findFirst.mockResolvedValue({ id: "a1" });
    expect((await hook(payload())).status).toBe(200);
    expect(db.activity.create).not.toHaveBeenCalled();
    db.activity.findFirst.mockResolvedValue(null);
    db.contact.findFirst.mockResolvedValue({ id: "c1", ownerId: "sales1", firstName: "Ada", lastName: "Okafor" });
    db.activity.create.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" })); // lost a race
    expect((await hook(payload())).status).toBe(200);
    expect(db.task.create).not.toHaveBeenCalled();
  });

  it("answers 500 when saving fails so Meta tries again", async () => {
    db.contact.findFirst.mockRejectedValue(new Error("db down"));
    expect((await hook(payload())).status).toBe(500);
  });
});

describe("replying from the CRM", () => {
  beforeEach(() => db.contact.findFirst.mockResolvedValue({ id: "c1", phoneE164: "+4915906462275" }));

  it("sends free text inside 24 hours, then logs it as OUT with Meta's id", async () => {
    db.activity.findFirst.mockResolvedValue({ occurredAt: new Date(Date.now() - 3_600_000) });
    sendFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.out1" }] }) });
    const res = await send(sendReq("Yes, $120"), id);
    expect(res.status).toBe(201);
    const [url, init] = sendFetch.mock.calls[0];
    expect(url).toContain("/123/messages");
    expect(JSON.parse(init.body)).toMatchObject({ to: "4915906462275", type: "text", text: { body: "Yes, $120" } });
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(db.activity.create.mock.calls[0][0].data).toMatchObject({ direction: "OUT", externalId: "wamid.out1", authorId: "u1", contactId: "c1" });
  });

  it("refuses outside the 24 hour window or with no inbound message, without calling Meta", async () => {
    db.activity.findFirst.mockResolvedValue({ occurredAt: new Date(Date.now() - 25 * 3_600_000) });
    expect((await send(sendReq("hi"), id)).status).toBe(409);
    db.activity.findFirst.mockResolvedValue(null);
    expect((await send(sendReq("hi"), id)).status).toBe(409);
    expect(sendFetch).not.toHaveBeenCalled();
    expect(await (await status(new Request("http://x.test"), id)).json()).toEqual({ data: { configured: true, canSend: false } });
  });

  it("reports Meta's refusal and logs nothing", async () => {
    db.activity.findFirst.mockResolvedValue({ occurredAt: new Date() });
    sendFetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { message: "Recipient not in allowed list" } }) });
    expect((await send(sendReq("hi"), id)).status).toBe(502);
    expect(db.activity.create).not.toHaveBeenCalled();
  });

  it("needs a message and a valid phone number", async () => {
    expect((await send(sendReq("   "), id)).status).toBe(422);
    db.contact.findFirst.mockResolvedValue({ id: "c1", phoneE164: null });
    expect((await send(sendReq("hi"), id)).status).toBe(422);
  });
});
