import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, audit } = vi.hoisted(() => ({
  db: {
    emailTemplate: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findFirstOrThrow: vi.fn(), findFirst: vi.fn(), deleteMany: vi.fn() },
  },
  audit: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/audit", () => ({ audit }));
vi.mock("@/lib/route", () => ({
  authed: (handler: (ctx: unknown) => Promise<Response>, ...roles: string[]) => async (req: Request, context?: { params: Promise<unknown> }) => {
    try {
      // Mirrors the real wrapper: a restricted route refuses anyone who is not an admin.
      const role = req.headers.get("x-test-role") ?? "ADMIN";
      if (roles.length && role !== "ADMIN" && !roles.includes(role)) return new Response(null, { status: 403 });
      return await handler({ req, user: { id: "u1", tenantId: "t1", role, name: "Boss", email: "b@x.test" }, params: (await context?.params) ?? {} });
    } catch (e) {
      const err = e as { status?: number };
      return new Response(null, { status: err.status ?? 500 });
    }
  },
}));

import { DELETE, PATCH } from "@/app/api/email-templates/[id]/route";
import { GET, POST } from "@/app/api/email-templates/route";
import { fillTemplate, oneLineSubject } from "@/lib/email-template-vars";
import { createEmailTemplateSchema, updateEmailTemplateSchema } from "@/lib/validations/crm";

const json = (method: string, body?: unknown, role?: string) =>
  new Request("http://x.test/api/email-templates", {
    method,
    headers: { "Content-Type": "application/json", ...(role ? { "x-test-role": role } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const idCtx = { params: Promise.resolve({ id: "t1" }) };
const valid = { name: "Quote", subject: "Your quote", body: "Hi {firstName}" };

beforeEach(() => vi.clearAllMocks());

describe("fillTemplate", () => {
  const vars = { firstName: "Adaeze", lastName: "Okafor", company: "", senderName: "Sam" };

  it("fills the known words", () => {
    expect(fillTemplate("Hi {firstName} {lastName}, from {senderName}", vars)).toBe("Hi Adaeze Okafor, from Sam");
  });

  it("empties a known word with no value and leaves unknown words alone", () => {
    expect(fillTemplate("At {company}: {unknown} {firstName}", vars)).toBe("At : {unknown} Adaeze");
    expect(fillTemplate("{company}|{lastName}", { firstName: "A" })).toBe("|");
  });

  it("does not run anything inside the braces", () => {
    expect(fillTemplate("{constructor} {__proto__} {toString}", vars)).toBe("{constructor} {__proto__} {toString}");
  });

  it("keeps a subject on one line", () => {
    expect(oneLineSubject("Hello\r\n  Bcc: x\ty ")).toBe("Hello Bcc: x y");
  });
});

describe("validation", () => {
  it("needs a name, a one-line subject and a message", () => {
    expect(createEmailTemplateSchema.safeParse(valid).success).toBe(true);
    expect(createEmailTemplateSchema.safeParse({ ...valid, name: " " }).success).toBe(false);
    expect(createEmailTemplateSchema.safeParse({ ...valid, subject: "a\nb" }).success).toBe(false);
    expect(createEmailTemplateSchema.safeParse({ ...valid, body: "" }).success).toBe(false);
    expect(updateEmailTemplateSchema.safeParse({}).success).toBe(false);
    expect(updateEmailTemplateSchema.safeParse({ name: "New name" }).success).toBe(true);
  });
});

describe("routes", () => {
  it("anyone signed in can list the templates", async () => {
    db.emailTemplate.findMany.mockResolvedValue([{ id: "t1", ...valid }]);
    const res = await GET(json("GET", undefined, "SALES"), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toHaveLength(1);
  });

  it("only admins can create, change or delete", async () => {
    expect((await POST(json("POST", valid, "SALES"), { params: Promise.resolve({}) })).status).toBe(403);
    expect((await PATCH(json("PATCH", { name: "x" }, "SUPPORT"), idCtx)).status).toBe(403);
    expect((await DELETE(json("DELETE", undefined, "SALES"), idCtx)).status).toBe(403);
    expect(db.emailTemplate.create).not.toHaveBeenCalled();
    expect(db.emailTemplate.updateMany).not.toHaveBeenCalled();
    expect(db.emailTemplate.deleteMany).not.toHaveBeenCalled();
  });

  it("an admin creates a template and it records who made it", async () => {
    db.emailTemplate.create.mockResolvedValue({ id: "t1", ...valid });
    const res = await POST(json("POST", valid), { params: Promise.resolve({}) });
    expect(res.status).toBe(201);
    expect(db.emailTemplate.create).toHaveBeenCalledWith({ data: { ...valid, tenantId: "t1", createdById: "u1" } });
  });

  it("changing a missing template is a 404", async () => {
    db.emailTemplate.updateMany.mockResolvedValue({ count: 0 });
    expect((await PATCH(json("PATCH", { name: "x" }), idCtx)).status).toBe(404);
  });

  it("deleting keeps a copy in the audit log first", async () => {
    db.emailTemplate.findFirst.mockResolvedValue({ id: "t1", ...valid });
    expect((await DELETE(json("DELETE"), idCtx)).status).toBe(204);
    expect(db.emailTemplate.deleteMany).toHaveBeenCalledWith({ where: { id: "t1", tenantId: "t1" } });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      expect.objectContaining({ action: "email_template.deleted", summary: "Quote", data: expect.objectContaining({ body: "Hi {firstName}" }) }),
      expect.anything(),
    );
    db.emailTemplate.findFirst.mockResolvedValue(null);
    expect((await DELETE(json("DELETE"), idCtx)).status).toBe(404);
  });
});
