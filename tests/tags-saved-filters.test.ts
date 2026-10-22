import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, audit } = vi.hoisted(() => {
  const db = {
    tag: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), findFirstOrThrow: vi.fn(), create: vi.fn(), count: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    savedFilter: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    contact: { count: vi.fn(), findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return { db, audit: vi.fn() };
});
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/audit", () => ({ audit }));
vi.mock("@/lib/access", async (orig) => ({
  ...(await orig<typeof import("@/lib/access")>()),
  assertLinks: vi.fn(),
  assertTags: vi.fn(),
  resolveOwner: vi.fn(async () => "u1"),
}));
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

import { DELETE as deleteFilter } from "@/app/api/saved-filters/[id]/route";
import { GET as listFilters, POST as saveFilter } from "@/app/api/saved-filters/route";
import { DELETE as deleteTag, PATCH as renameTag } from "@/app/api/tags/[id]/route";
import { GET as listTags, POST as createTag } from "@/app/api/tags/route";
import { GET as listContacts, POST as createContact } from "@/app/api/contacts/route";
import { PATCH as patchContact } from "@/app/api/contacts/[id]/route";
import { contactListQuery, createContactSchema } from "@/lib/validations/crm";

const req = (method: string, body?: unknown, role?: string, url = "http://x.test/api/x") =>
  new Request(url, { method, headers: { "Content-Type": "application/json", ...(role ? { "x-test-role": role } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const none = { params: Promise.resolve({}) };
const id = (v = "t1") => ({ params: Promise.resolve({ id: v }) });

beforeEach(() => vi.clearAllMocks());

describe("tags", () => {
  it("anyone signed in can list and add tags", async () => {
    db.tag.findMany.mockResolvedValue([{ id: "t1", name: "VIP" }]);
    expect((await listTags(req("GET", undefined, "SALES"), none)).status).toBe(200);
    db.tag.findFirst.mockResolvedValue(null);
    db.tag.count.mockResolvedValue(3);
    db.tag.create.mockResolvedValue({ id: "t2", name: "wholesale" });
    const res = await createTag(req("POST", { name: "  wholesale " }, "SALES"), none);
    expect(res.status).toBe(201);
    expect(db.tag.create).toHaveBeenCalledWith({ data: { tenantId: "t1", name: "wholesale" } });
  });

  it("asking for a name that exists (any capitals) returns that tag instead of a second one", async () => {
    db.tag.findFirst.mockResolvedValue({ id: "t1", name: "VIP" });
    const res = await createTag(req("POST", { name: "vip" }), none);
    expect(res.status).toBe(200);
    expect(db.tag.findFirst.mock.calls[0][0].where.name).toEqual({ equals: "vip", mode: "insensitive" });
    expect(db.tag.create).not.toHaveBeenCalled();
  });

  it("rejects an empty or very long name", async () => {
    expect((await createTag(req("POST", { name: "  " }), none)).status).toBe(422);
    expect((await createTag(req("POST", { name: "x".repeat(41) }), none)).status).toBe(422);
  });

  it("only admins rename or delete, and a rename cannot collide with another tag", async () => {
    expect((await renameTag(req("PATCH", { name: "x" }, "SALES"), id())).status).toBe(403);
    expect((await deleteTag(req("DELETE", undefined, "SUPPORT"), id())).status).toBe(403);
    db.tag.findFirst.mockResolvedValue({ id: "other", name: "Taken" });
    expect((await renameTag(req("PATCH", { name: "taken" }), id())).status).toBe(409);
    expect(db.tag.updateMany).not.toHaveBeenCalled();
  });

  it("deleting a tag is audited with how many contacts had it", async () => {
    db.tag.findFirst.mockResolvedValue({ id: "t1", name: "VIP", _count: { contacts: 4 } });
    expect((await deleteTag(req("DELETE"), id())).status).toBe(204);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" }), expect.objectContaining({ action: "tag.deleted", data: { name: "VIP", contacts: 4 } }), expect.anything());
    db.tag.findFirst.mockResolvedValue(null);
    expect((await deleteTag(req("DELETE"), id())).status).toBe(404);
  });
});

describe("saved filters", () => {
  const view = { entity: "contacts", name: "Wholesale leads", query: { type: "LEAD", tag: "t1" } };

  it("lists only your own views for the list asked for", async () => {
    db.savedFilter.findMany.mockResolvedValue([]);
    await listFilters(req("GET", undefined, "SALES", "http://x.test/api/saved-filters?entity=contacts"), none);
    expect(db.savedFilter.findMany.mock.calls[0][0].where).toEqual({ tenantId: "t1", userId: "u1", entity: "contacts" });
  });

  it("saves a view under your name; saving the same name again replaces it", async () => {
    db.savedFilter.findUnique.mockResolvedValue(null);
    db.savedFilter.count.mockResolvedValue(2);
    db.savedFilter.upsert.mockResolvedValue({ id: "f1", ...view });
    expect((await saveFilter(req("POST", view), none)).status).toBe(201);
    expect(db.savedFilter.upsert.mock.calls[0][0].create).toMatchObject({ tenantId: "t1", userId: "u1", entity: "contacts", name: "Wholesale leads" });
    db.savedFilter.findUnique.mockResolvedValue({ id: "f1" });
    expect((await saveFilter(req("POST", view), none)).status).toBe(200);
  });

  it("caps a person at 20 views per list but still lets them overwrite one", async () => {
    db.savedFilter.findUnique.mockResolvedValue(null);
    db.savedFilter.count.mockResolvedValue(20);
    expect((await saveFilter(req("POST", view), none)).status).toBe(422);
    expect(db.savedFilter.upsert).not.toHaveBeenCalled();
    db.savedFilter.findUnique.mockResolvedValue({ id: "f1" });
    db.savedFilter.upsert.mockResolvedValue({ id: "f1" });
    expect((await saveFilter(req("POST", view), none)).status).toBe(200);
  });

  it("rejects unknown lists, long names and stray fields in the query", async () => {
    expect((await saveFilter(req("POST", { ...view, entity: "deals" }), none)).status).toBe(422);
    expect((await saveFilter(req("POST", { ...view, name: "x".repeat(41) }), none)).status).toBe(422);
    expect((await saveFilter(req("POST", { ...view, query: { tag: "t1", q: "x".repeat(101) } }), none)).status).toBe(422);
  });

  it("deletes only your own view; someone else's id is a 404", async () => {
    db.savedFilter.deleteMany.mockResolvedValue({ count: 1 });
    expect((await deleteFilter(req("DELETE"), id("f1"))).status).toBe(204);
    expect(db.savedFilter.deleteMany).toHaveBeenCalledWith({ where: { id: "f1", userId: "u1", tenantId: "t1" } });
    db.savedFilter.deleteMany.mockResolvedValue({ count: 0 });
    expect((await deleteFilter(req("DELETE"), id("f2"))).status).toBe(404);
  });
});

describe("tags on contacts", () => {
  beforeEach(() => {
    db.contact.count.mockResolvedValue(0);
    db.contact.findMany.mockResolvedValue([]);
  });

  it("filters the list by tag, on top of the owner scope", async () => {
    await listContacts(req("GET", undefined, "SALES", "http://x.test/api/contacts?tag=t1"), none);
    const where = JSON.stringify(db.contact.findMany.mock.calls[0][0].where);
    expect(where).toContain('"tags":{"some":{"tagId":"t1"}}');
    expect(where).toContain('"ownerId":"u1"'); // a sales user still only sees their own contacts
    expect(contactListQuery.safeParse({ tag: "t1" }).success).toBe(true);
  });

  it("creates a contact with its tags (each once)", async () => {
    db.contact.create.mockResolvedValue({ id: "c1" });
    const res = await createContact(req("POST", { firstName: "Ada", lastName: "Okafor", tagIds: ["t1", "t2", "t1"] }), none);
    expect(res.status).toBe(201);
    const data = db.contact.create.mock.calls[0][0].data;
    expect(data.tags).toEqual({ create: [{ tenantId: "t1", tagId: "t1" }, { tenantId: "t1", tagId: "t2" }] });
    expect(data).not.toHaveProperty("tagIds");
  });

  it("a contact with no tags sends no tag change; an update replaces the list as a whole", async () => {
    db.contact.create.mockResolvedValue({ id: "c1" });
    await createContact(req("POST", { firstName: "Ada", lastName: "Okafor" }), none);
    expect(db.contact.create.mock.calls[0][0].data).not.toHaveProperty("tags");

    db.contact.findFirst.mockResolvedValue({ id: "c1" });
    db.contact.update.mockResolvedValue({ id: "c1" });
    await patchContact(req("PATCH", { tagIds: ["t2"] }), id("c1"));
    expect(db.contact.update.mock.calls[0][0].data.tags).toEqual({ deleteMany: {}, create: [{ tenantId: "t1", tagId: "t2" }] });
    await patchContact(req("PATCH", { tagIds: [] }), id("c1"));
    expect(db.contact.update.mock.calls[1][0].data.tags).toEqual({ deleteMany: {}, create: [] }); // clears them
    await patchContact(req("PATCH", { title: "Buyer" }), id("c1"));
    expect(db.contact.update.mock.calls[2][0].data).not.toHaveProperty("tags"); // untouched when not sent
  });

  it("limits a contact to 20 tags", () => {
    expect(createContactSchema.safeParse({ firstName: "A", lastName: "B", tagIds: Array.from({ length: 21 }, (_, n) => `t${n}`) }).success).toBe(false);
  });
});
