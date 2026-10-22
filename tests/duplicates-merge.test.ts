import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, audit } = vi.hoisted(() => {
  const db = {
    contact: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), findFirstOrThrow: vi.fn() },
    deal: { updateMany: vi.fn() },
    activity: { updateMany: vi.fn() },
    task: { updateMany: vi.fn() },
    contactTag: { createMany: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return { db, audit: vi.fn() };
});
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/audit", () => ({ audit }));
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

import { GET as duplicates } from "@/app/api/contacts/duplicates/route";
import { POST as merge } from "@/app/api/contacts/[id]/merge/route";

const req = (method: string, body?: unknown, role?: string, url = "http://x.test/api/x") =>
  new Request(url, { method, headers: { "Content-Type": "application/json", ...(role ? { "x-test-role": role } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const none = { params: Promise.resolve({}) };
const id = (v = "a") => ({ params: Promise.resolve({ id: v }) });

beforeEach(() => {
  vi.clearAllMocks();
  db.deal.updateMany.mockResolvedValue({ count: 2 });
  db.activity.updateMany.mockResolvedValue({ count: 5 });
  db.task.updateMany.mockResolvedValue({ count: 1 });
});

describe("duplicate check", () => {
  it("matches a phone written differently, and the same name in other capitals, inside the caller's scope", async () => {
    db.contact.findMany.mockResolvedValue([
      { id: "c1", firstName: "Ada", lastName: "Okafor", email: null, phone: "0049 159 0646 2275", phoneE164: "+4915906462275", type: "CUSTOMER" },
    ]);
    const url = "http://x.test/api/contacts/duplicates?firstName=ADA&lastName=okafor&phone=%2B49%20159%200646%202275";
    const res = await duplicates(req("GET", undefined, "SALES", url), none);
    const body = await res.json();
    expect(body.data[0].reasons).toEqual(["Same phone number", "Same name"]);
    expect(body.data[0]).not.toHaveProperty("phoneE164");
    const where = JSON.stringify(db.contact.findMany.mock.calls[0][0].where);
    expect(where).toContain('"phoneE164":"+4915906462275"');
    expect(where).toContain('"ownerId":"u1"'); // a sales user only hears about their own contacts
  });

  it("does not ask the database when there is nothing to compare, and can leave out the contact being edited", async () => {
    await duplicates(req("GET", undefined, undefined, "http://x.test/api/contacts/duplicates?firstName=Ada"), none);
    expect(db.contact.findMany).not.toHaveBeenCalled();
    db.contact.findMany.mockResolvedValue([]);
    await duplicates(req("GET", undefined, undefined, "http://x.test/api/contacts/duplicates?firstName=A&lastName=B&excludeId=c9"), none);
    expect(JSON.stringify(db.contact.findMany.mock.calls[0][0].where)).toContain('"id":{"not":"c9"}');
  });
});

describe("merge", () => {
  const from = { id: "a", firstName: "Ada", lastName: "O", email: "ada@x.test", phone: "+49 1", phoneE164: "+491", title: "Buyer", type: "CUSTOMER", emailOptOut: true, organizationId: "o1", tags: [{ tagId: "t1" }, { tagId: "t2" }] };
  const into = { id: "b", firstName: "Ada", lastName: "Okafor", email: null, phone: null, phoneE164: null, title: "Owner", type: "LEAD", emailOptOut: false, organizationId: null };

  beforeEach(() => {
    db.contact.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === "a" ? from : into));
    db.contact.findFirstOrThrow.mockResolvedValue({ id: "b" });
  });

  it("is admin only", async () => {
    expect((await merge(req("POST", { intoId: "b" }, "SALES"), id())).status).toBe(403);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("will not merge a contact into itself or into one that is gone", async () => {
    expect((await merge(req("POST", { intoId: "a" }), id("a"))).status).toBe(422);
    db.contact.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === "a" ? from : null));
    expect((await merge(req("POST", { intoId: "zzz" }), id("a"))).status).toBe(404);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("moves deals, activities, tasks and tags, fills only the blanks, and frees the email before the kept contact takes it", async () => {
    const res = await merge(req("POST", { intoId: "b" }), id("a"));
    expect(res.status).toBe(200);
    expect(db.deal.updateMany).toHaveBeenCalledWith({ where: { tenantId: "t1", contactId: "a" }, data: { contactId: "b" } });
    expect(db.activity.updateMany).toHaveBeenCalledWith({ where: { tenantId: "t1", contactId: "a" }, data: { contactId: "b" } });
    expect(db.task.updateMany).toHaveBeenCalledWith({ where: { tenantId: "t1", contactId: "a" }, data: { contactId: "b" } });
    expect(db.contactTag.createMany).toHaveBeenCalledWith({ data: [{ tenantId: "t1", contactId: "b", tagId: "t1" }, { tenantId: "t1", contactId: "b", tagId: "t2" }], skipDuplicates: true });
    const [removed, kept] = db.contact.update.mock.calls.map((c) => c[0]);
    expect(removed.where.id).toBe("a");
    expect(removed.data).toMatchObject({ email: null });
    expect(removed.data.deletedAt).toBeInstanceOf(Date);
    expect(kept.where.id).toBe("b");
    expect(kept.data).toMatchObject({ email: "ada@x.test", phone: "+49 1", phoneE164: "+491", organizationId: "o1", type: "CUSTOMER", leadStatus: null, emailOptOut: true });
    expect(kept.data).not.toHaveProperty("title"); // the kept contact already had one
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      expect.objectContaining({ action: "contact.merged", entityId: "b", data: expect.objectContaining({ removedId: "a", moved: { deals: 2, activities: 5, tasks: 1, tags: 2 } }) }),
      expect.anything(),
    );
  });
});
