import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";

const m = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  stepUp: vi.fn(),
  orgCount: vi.fn(),
  orgFindMany: vi.fn(),
  taskCount: vi.fn(),
  taskFindMany: vi.fn(),
  activityCount: vi.fn(),
  activityFindMany: vi.fn(),
  paymentCount: vi.fn(),
  paymentFindMany: vi.fn(),
  contactCount: vi.fn(),
  contactFindMany: vi.fn(),
  auditFindMany: vi.fn(),
  auditCount: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({ requireApiUser: m.requireApiUser }));
vi.mock("@/lib/mfa-server", () => ({ stepUpForUser: m.stepUp }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }) }));
vi.mock("@/lib/db", () => ({
  db: {
    organization: { count: m.orgCount, findMany: m.orgFindMany },
    task: { count: m.taskCount, findMany: m.taskFindMany },
    activity: { count: m.activityCount, findMany: m.activityFindMany },
    payment: { count: m.paymentCount, findMany: m.paymentFindMany },
    contact: { count: m.contactCount, findMany: m.contactFindMany },
    // count/create double as the export rate limit and the audit write; findMany serves the audit-log export
    auditLog: { count: m.auditCount, create: m.auditCreate, findMany: m.auditFindMany },
  },
}));

import { GET, POST } from "@/app/api/export/[entity]/route";

type U = { id: string; role: string; email: string };
const sales: U = { id: "sales-1", role: "SALES", email: "sales@crm.test" };
const admin: U = { id: "admin-1", role: "ADMIN", email: "admin@crm.test" };

const url = (entity: string, query = "") => `http://localhost/api/export/${entity}${query}`;
const ctx = (entity: string) => ({ params: Promise.resolve({ entity }) });
const get = (entity: string, query = "") => GET(new Request(url(entity, query)), ctx(entity));
const post = (entity: string, body: unknown, query = "") =>
  POST(
    new Request(url(entity, query), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    ctx(entity),
  );

const asUser = (u: U) => m.requireApiUser.mockResolvedValue({ ok: true, user: u });
const org = (over: Record<string, unknown> = {}) => ({
  id: "o1", name: "Acme", domain: null, industry: "Retail", size: 5, website: null, phone: "+234 800", address: null,
  city: "Lagos", state: null, country: "NG", deletedAt: null, createdAt: new Date("2026-01-02T00:00:00Z"),
  updatedAt: new Date("2026-01-03T00:00:00Z"), owner: { name: "Sam" }, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.stepUp.mockResolvedValue(undefined);
  m.auditCount.mockResolvedValue(0);
  m.auditCreate.mockResolvedValue({});
  m.auditFindMany.mockResolvedValue([]);
  m.orgCount.mockResolvedValue(1);
  m.orgFindMany.mockResolvedValue([org()]);
  for (const f of [m.taskCount, m.activityCount, m.paymentCount, m.contactCount]) f.mockResolvedValue(0);
  for (const f of [m.taskFindMany, m.activityFindMany, m.paymentFindMany, m.contactFindMany]) f.mockResolvedValue([]);
  asUser(sales);
});

describe("GET /api/export/:entity", () => {
  it("rejects signed-out callers", async () => {
    m.requireApiUser.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await get("organizations")).status).toBe(401);
    expect(m.orgFindMany).not.toHaveBeenCalled();
  });

  it("404s for anything that is not an exportable area", async () => {
    for (const e of ["audit", "users", "sessions", "constructor", "__proto__", "toString"]) {
      expect((await get(e)).status, e).toBe(404);
    }
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("keeps contacts and the audit log from everyone but admins", async () => {
    for (const e of ["contacts", "audit-log"]) {
      expect((await get(e)).status, e).toBe(403);
    }
    expect(m.contactCount).not.toHaveBeenCalled();
    expect(m.auditFindMany).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("lets an admin export contacts with the whole email/phone/address set", async () => {
    asUser(admin);
    m.contactCount.mockResolvedValue(1);
    m.contactFindMany.mockResolvedValue([
      { id: "c1", firstName: "Ada", lastName: "Eze", email: "ada@example.com", phone: "+234 1", title: null, type: "CUSTOMER",
        leadStatus: null, source: null, address: "1 Road", city: "Lagos", state: null, postalCode: null, country: "NG",
        deletedAt: null, createdAt: new Date(0), updatedAt: new Date(0), organization: { name: "Acme" }, owner: { name: "Sam" } },
    ]);
    const res = await get("contacts");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("ada@example.com");
    expect(text).toContain("firstName,lastName,email,phone");
  });

  it("scopes a salesperson to their own rows and hides deleted ones", async () => {
    await (await get("organizations")).text();
    const where = m.orgFindMany.mock.calls[0][0].where;
    expect(where.AND).toContainEqual({ deletedAt: null });
    expect(where.AND).toContainEqual({ ownerId: "sales-1" });
    expect(m.orgCount.mock.calls[0][0].where.AND).toContainEqual({ ownerId: "sales-1" });
  });

  it("never exports deleted rows over GET, even for an admin who asks in the URL", async () => {
    asUser(admin);
    await (await get("organizations", "?includeDeleted=true")).text();
    const where = m.orgFindMany.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({ deletedAt: null });
    expect(where.AND[1]).toEqual({});
  });

  it("ignores an ownerId filter that would widen a salesperson's view", async () => {
    await (await get("organizations", "?ownerId=someone-else")).text();
    expect(m.orgFindMany.mock.calls[0][0].where.AND).toContainEqual({ ownerId: "sales-1" });
  });

  it("scopes tasks, activities and payments like their list screens", async () => {
    await (await get("tasks")).text();
    expect(m.taskFindMany.mock.calls[0][0].where.AND).toContainEqual({ OR: [{ assigneeId: "sales-1" }, { createdById: "sales-1" }] });
    await (await get("activities")).text();
    expect(m.activityFindMany.mock.calls[0][0].where.AND).toContainEqual({ authorId: "sales-1" });
    await (await get("payments")).text();
    expect(m.paymentCount.mock.calls[0][0].where.deal.AND).toContainEqual({ ownerId: "sales-1" });
  });

  it("returns a CSV download with a BOM, header row, safe headers and escaped formulas", async () => {
    m.orgFindMany.mockResolvedValue([org({ name: '=HYPERLINK("http://evil")' })]);
    const res = await get("organizations");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="organizations-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
    // text() drops a leading BOM when decoding, so check the raw bytes.
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    expect(text.startsWith("﻿id,name,domain,industry")).toBe(true);
    expect(text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(text.split("\r\n").filter(Boolean)).toHaveLength(2);
  });

  it("writes the audit entry before any data is read, with who, what and how many", async () => {
    const res = await get("organizations", "?q=acme");
    expect(m.auditCreate).toHaveBeenCalledTimes(1);
    const data = m.auditCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ actorId: "sales-1", actorEmail: "sales@crm.test", action: "EXPORT", entity: "organizations", ip: "203.0.113.9" });
    expect(data.data).toMatchObject({ format: "csv", rows: 1, filters: { q: "acme" } });
    await res.text();
  });

  it("sends nothing when the audit entry cannot be written", async () => {
    m.auditCreate.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await get("organizations")).status).toBe(500);
    expect(m.orgFindMany).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("refuses more than the row cap and tells the user to filter", async () => {
    m.orgCount.mockResolvedValue(50_001);
    const res = await get("organizations");
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("EXPORT_TOO_LARGE");
    expect(m.auditCreate).not.toHaveBeenCalled();
    expect(m.orgFindMany).not.toHaveBeenCalled();
  });

  it("allows exactly the cap", async () => {
    m.orgCount.mockResolvedValue(50_000);
    expect((await get("organizations")).status).toBe(200);
  });

  it("limits exports per user", async () => {
    m.auditCount.mockResolvedValue(5);
    const res = await get("organizations");
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("RATE_LIMITED");
    expect(m.auditCreate).not.toHaveBeenCalled();
    expect(m.auditCount.mock.calls[0][0].where).toMatchObject({ actorId: "sales-1", action: "EXPORT" });
  });

  it("fails closed when the limit cannot be checked", async () => {
    m.auditCount.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await get("organizations")).status).toBe(500);
    expect(m.orgFindMany).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("rejects a format it cannot make", async () => {
    expect((await get("organizations", "?format=pdf")).status).toBe(422);
  });

  it("tells an admin the audit log needs a code, and does not serve it over GET", async () => {
    asUser(admin);
    const res = await get("audit-log");
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("STEP_UP_REQUIRED");
    expect(m.auditFindMany).not.toHaveBeenCalled();
    expect(m.stepUp).not.toHaveBeenCalled();
  });
});

describe("POST /api/export/:entity (needs a code)", () => {
  beforeEach(() => asUser(admin));

  it("exports the audit log after checking the code", async () => {
    m.auditCount.mockResolvedValueOnce(0).mockResolvedValue(3); // rate limit check, then the row count
    m.auditFindMany.mockResolvedValue([
      { id: "a1", createdAt: new Date(0), actorId: "u1", actorEmail: "x@y.z", action: "POST /api/deals", entity: "deals",
        entityId: "d1", summary: null, ip: "1.2.3.4", data: { snapshot: { title: "=cmd" } } },
    ]);
    const res = await post("audit-log", { code: "123456" });
    expect(res.status).toBe(200);
    expect(m.stepUp).toHaveBeenCalledWith("admin-1", "123456");
    const text = await res.text();
    expect(text).toContain("POST /api/deals");
    // the JSON snapshot is one quoted cell
    expect(text).toContain('"{""snapshot"":{""title"":""=cmd""}}"');
    // exactly one audit record, written by the export (not a second generic one from authed())
    expect(m.auditCreate).toHaveBeenCalledTimes(1);
    expect(m.auditCreate.mock.calls[0][0].data).toMatchObject({ action: "EXPORT", entity: "audit-log" });
  });

  it("sends nothing and records nothing when the code is wrong", async () => {
    m.stepUp.mockRejectedValue(new ApiError(400, "That code is not right", "BAD_REQUEST"));
    const res = await post("audit-log", { code: "000000" });
    expect(res.status).toBe(400);
    expect(m.auditFindMany).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("does not spend the code on an export that would be refused anyway", async () => {
    m.auditCount.mockResolvedValueOnce(0).mockResolvedValue(50_001);
    const res = await post("audit-log", { code: "123456" });
    expect(res.status).toBe(422);
    expect(m.stepUp).not.toHaveBeenCalled();
  });

  it("serves deleted rows to an admin with a code, and only then", async () => {
    const res = await post("organizations", { code: "123456", includeDeleted: true });
    expect(res.status).toBe(200);
    expect(m.stepUp).toHaveBeenCalledWith("admin-1", "123456");
    await res.text(); // the rows are read while the file streams
    expect(m.orgFindMany.mock.calls[0][0].where.AND[0]).toEqual({});
    expect(m.auditCreate.mock.calls[0][0].data.data.filters).toMatchObject({ includeDeleted: true });
  });

  it("refuses deleted rows for areas that have none", async () => {
    const res = await post("tasks", { code: "123456", includeDeleted: true });
    expect(res.status).toBe(422);
    expect(m.stepUp).not.toHaveBeenCalled();
  });

  it("lets a normal export through POST without needing a code", async () => {
    expect((await post("organizations", {})).status).toBe(200);
    expect(m.stepUp).not.toHaveBeenCalled();
  });

  it("refuses non-admins who ask for deleted rows or admin areas", async () => {
    asUser(sales);
    expect((await post("organizations", { includeDeleted: true, code: "123456" })).status).toBe(403);
    expect((await post("audit-log", { code: "123456" })).status).toBe(403);
    expect((await post("contacts", {})).status).toBe(403);
    expect(m.stepUp).not.toHaveBeenCalled();
    expect(m.orgFindMany).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("rejects a malformed body", async () => {
    expect((await post("organizations", { includeDeleted: "yes" })).status).toBe(422);
  });
});
