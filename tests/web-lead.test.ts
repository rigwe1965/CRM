import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, audit, trySendMail, rateLimit } = vi.hoisted(() => ({
  db: {
    automationSetting: { findUnique: vi.fn(), upsert: vi.fn() },
    user: { findFirst: vi.fn() },
    contact: { findFirst: vi.fn(), create: vi.fn() },
    activity: { create: vi.fn() },
    task: { create: vi.fn() },
  },
  audit: vi.fn(),
  trySendMail: vi.fn(async (_mail: { to: string; subject: string; text: string }) => true),
  rateLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/audit", () => ({ audit }));
vi.mock("@/lib/mail", () => ({ trySendMail, appUrl: () => "https://crm.test" }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit, clientIp: () => "1.2.3.4", LIMITS: { webLead: {}, webLeadAll: {} } }));

import { OPTIONS, POST } from "@/app/api/public/lead/route";
import { isPublicPath } from "@/lib/rbac";
import { webLeadSchema } from "@/lib/validations/crm";

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request("http://crm.test/api/public/lead", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));

const admin = { id: "admin1", name: "Boss", email: "boss@x.test" };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LEAD_FORM_ORIGINS = "https://shop.test";
  rateLimit.mockResolvedValue({ allowed: true, retryAfter: 0 });
  db.automationSetting.findUnique.mockResolvedValue(null);
  db.user.findFirst.mockResolvedValue(admin);
  db.contact.findFirst.mockResolvedValue(null);
  db.contact.create.mockResolvedValue({ id: "c1" });
});

describe("website lead form", () => {
  it("is reachable without signing in", () => {
    expect(isPublicPath("/api/public/lead")).toBe(true);
  });

  it("creates a Website lead for the owner with a note, a reply task and an email alert", async () => {
    const res = await post({ name: "  Ada   Okafor ", email: "Ada@X.test", phone: "+49 159 0646 2275", message: "Do you have 24 inch bundles?" }, { origin: "https://shop.test" });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://shop.test");
    expect(db.contact.create.mock.calls[0][0].data).toMatchObject({ firstName: "Ada", lastName: "Okafor", email: "ada@x.test", type: "LEAD", source: "Website", ownerId: "admin1", phoneE164: "+4915906462275" });
    expect(db.activity.create.mock.calls[0][0].data).toMatchObject({ contactId: "c1", authorId: "admin1", body: "Do you have 24 inch bundles?" });
    expect(db.task.create.mock.calls[0][0].data).toMatchObject({ assigneeId: "admin1", contactId: "c1", automationKey: "weblead:c1" });
    expect(trySendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "boss@x.test", subject: "New website lead: Ada Okafor" }));
  });

  it("does not create a second contact for a known email, and still answers the same", async () => {
    db.contact.findFirst.mockResolvedValue({ id: "c9", ownerId: "sales1", firstName: "Ada", lastName: "Okafor" });
    db.user.findFirst.mockResolvedValueOnce(admin).mockResolvedValueOnce({ email: "sales@x.test" }); // the default owner, then the contact's owner
    const res = await post({ name: "Ada Okafor", email: "ada@x.test" });
    expect(await res.json()).toEqual({ ok: true });
    expect(db.contact.create).not.toHaveBeenCalled();
    expect(db.task.create).not.toHaveBeenCalled();
    expect(db.activity.create.mock.calls[0][0].data).toMatchObject({ contactId: "c9", authorId: "sales1" });
    expect(trySendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "sales@x.test" }));
  });

  it("marks text added to a known contact as unverified and shows only a 100-character preview in the alert", async () => {
    db.contact.findFirst.mockResolvedValue({ id: "c9", ownerId: "sales1", firstName: "Ada", lastName: "Okafor" });
    db.user.findFirst.mockResolvedValueOnce(admin).mockResolvedValueOnce({ email: "sales@x.test" });
    const message = `Pay now at evil.test\n${"x".repeat(200)}`;
    await post({ name: "Totally Someone Else", email: "ada@x.test", phone: "+4915906462275", message });
    expect(db.activity.create.mock.calls[0][0].data.body).toBe(`[Unverified website form submission]\n${message}`);
    const mail = trySendMail.mock.calls[0][0];
    expect(mail.subject).toBe("Website form again: Ada Okafor");
    expect(mail.text).toContain("Preview (unverified, first 100 characters):");
    expect(mail.text).toContain("Pay now at evil.test");
    expect(mail.text).toContain("…");
    expect(mail.text).not.toContain("x".repeat(101));
    expect(mail.text).not.toContain("Totally Someone Else");
    expect(mail.text).not.toContain("+4915906462275");
    expect(mail.text).toContain("https://crm.test/contacts/c9");
  });

  it("uses the chosen owner when active, otherwise the first admin", async () => {
    db.automationSetting.findUnique.mockResolvedValue({ config: { ownerId: "sales1" } });
    db.user.findFirst.mockResolvedValueOnce({ id: "sales1", name: "Sam", email: "sam@x.test" });
    await post({ name: "Ada Okafor", email: "a@x.test" });
    expect(db.contact.create.mock.calls[0][0].data.ownerId).toBe("sales1");
  });

  it("saves nothing for a bot that fills the hidden field, but answers as if it worked", async () => {
    const res = await post({ name: "Bot", email: "b@x.test", website: "http://spam.test" });
    expect(await res.json()).toEqual({ ok: true });
    expect(db.contact.create).not.toHaveBeenCalled();
    expect(trySendMail).not.toHaveBeenCalled();
  });

  it("refuses browsers on websites that are not listed, and answers the preflight only for listed ones", async () => {
    expect((await post({ name: "Ada", email: "a@x.test" }, { origin: "https://evil.test" })).status).toBe(403);
    expect(db.contact.create).not.toHaveBeenCalled();
    const pre = (origin: string) => OPTIONS(new Request("http://crm.test/api/public/lead", { method: "OPTIONS", headers: { origin } }));
    expect((await pre("https://shop.test")).status).toBe(204);
    expect((await pre("https://evil.test")).status).toBe(403);
    process.env.LEAD_FORM_ORIGINS = "";
    expect((await post({ name: "Ada", email: "a@x.test" }, { origin: "https://shop.test" })).status).toBe(403);
  });

  it("is rate limited, size limited and validated", async () => {
    rateLimit.mockResolvedValue({ allowed: false, retryAfter: 120 });
    const limited = await post({ name: "Ada", email: "a@x.test" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("120");
    rateLimit.mockResolvedValue({ allowed: true, retryAfter: 0 });
    expect((await post("x".repeat(10_001))).status).toBe(413);
    expect((await post("not json")).status).toBe(400);
    const bad = await post({ name: "Ada" });
    expect(bad.status).toBe(422);
    expect((await bad.json()).fields.email).toMatch(/email address or a phone/);
    expect(db.contact.create).not.toHaveBeenCalled();
  });

  it("keeps the lead even when the alert email fails, and never leaks a server error message", async () => {
    trySendMail.mockResolvedValueOnce(false);
    expect((await post({ name: "Ada", phone: "+4915906462275" })).status).toBe(200);
    db.contact.create.mockRejectedValueOnce(new Error("db password is hunter2"));
    const res = await post({ name: "Ada", phone: "+4915906462275" });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("hunter2");
  });

  it("needs a name and one way to reply", () => {
    expect(webLeadSchema.safeParse({ name: "Ada", phone: "123" }).success).toBe(true);
    expect(webLeadSchema.safeParse({ name: "", email: "a@x.test" }).success).toBe(false);
    expect(webLeadSchema.safeParse({ name: "Ada", email: "nope" }).success).toBe(false);
  });
});
