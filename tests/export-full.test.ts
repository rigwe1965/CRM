import { beforeEach, describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { ApiError } from "@/lib/api";

const m = vi.hoisted(() => {
  const model = () => ({ count: vi.fn(), findMany: vi.fn() });
  return {
    requireApiUser: vi.fn(),
    stepUp: vi.fn(),
    organization: model(),
    deal: model(),
    dealItem: model(),
    payment: model(),
    instalment: model(),
    invoice: model(),
    invoiceItem: model(),
    task: model(),
    activity: model(),
    contact: model(),
    aiUsage: model(),
    aiConversation: model(),
    aiProposal: model(),
    auditLog: { ...model(), create: vi.fn() },
  };
});

vi.mock("@/lib/auth-helpers", () => ({ requireApiUser: m.requireApiUser }));
vi.mock("@/lib/mfa-server", () => ({ stepUpForUser: m.stepUp }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }) }));
vi.mock("@/lib/stock", () => ({ loadStock: async () => ({ rows: [], unmatched: [] }) }));
vi.mock("@/lib/cashflow", () => ({
  cashflow: async () => ({
    collected: { total: { NGN: 100 }, last30Days: {} },
    owed: { amount: {}, deals: 0 },
    overdue: { amount: {}, deals: 0 },
    profit: {},
  }),
}));
vi.mock("@/lib/db", () => ({ db: m }));

import { POST } from "@/app/api/export/full/route";
import { EXPORTS } from "@/lib/export/registry";

const admin = { id: "admin-1", role: "ADMIN", email: "admin@crm.test" };
const sales = { id: "sales-1", role: "SALES", email: "sales@crm.test" };

/** Mirrors authed(): a role check, which is what `authed(handler, "ADMIN")` enforces. */
const asUser = (u: typeof admin) =>
  m.requireApiUser.mockImplementation(async (...roles: string[]) =>
    roles.length && u.role !== "ADMIN" && !roles.includes(u.role)
      ? { ok: false, response: new Response(JSON.stringify({ error: "Forbidden", code: "FORBIDDEN" }), { status: 403 }) }
      : { ok: true, user: u },
  );

const post = (body: unknown = {}) =>
  POST(
    new Request("http://localhost/api/export/full", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({}) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  m.stepUp.mockResolvedValue(undefined);
  m.auditLog.create.mockResolvedValue({});
  for (const model of [m.organization, m.deal, m.dealItem, m.payment, m.instalment, m.invoice, m.invoiceItem, m.task, m.activity, m.contact, m.aiUsage, m.aiConversation, m.aiProposal]) {
    model.count.mockResolvedValue(0);
    model.findMany.mockResolvedValue([]);
  }
  // the export limit (count of recent EXPORT entries), then the audit-log row count
  m.auditLog.count.mockResolvedValue(0);
  m.auditLog.findMany.mockResolvedValue([]);
  asUser(admin);
});

describe("POST /api/export/full", () => {
  it("is for admins only", async () => {
    asUser(sales);
    const res = await post({ code: "123456" });
    expect(res.status).toBe(403);
    expect(m.stepUp).not.toHaveBeenCalled();
    expect(m.auditLog.create).not.toHaveBeenCalled();
  });

  it("returns a zip with one CSV per area and a README, after checking the code", async () => {
    m.organization.count.mockResolvedValue(1);
    m.organization.findMany.mockResolvedValue([
      { id: "o1", name: "=Acme", domain: null, industry: null, size: null, website: null, phone: null, address: null, city: null,
        state: null, country: null, deletedAt: new Date("2026-02-01T00:00:00Z"), createdAt: new Date(0), updatedAt: new Date(0), owner: null },
    ]);
    const res = await post({ code: "123456" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="ivycandy-crm-export-\d{4}-\d{2}-\d{2}\.zip"$/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(m.stepUp).toHaveBeenCalledWith("admin-1", "123456");

    const unzipped = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const names = Object.keys(unzipped).sort();
    expect(names).toEqual([...Object.values(EXPORTS).map((e) => `${e.file}.csv`), "README.txt"].sort());

    // every CSV starts with a byte order mark (the text decoder drops it, so look at the bytes)
    for (const [name, data] of Object.entries(unzipped)) {
      if (name.endsWith(".csv")) expect([...data.slice(0, 3)], name).toEqual([0xef, 0xbb, 0xbf]);
    }
    const orgs = strFromU8(unzipped["organizations.csv"]);
    expect(orgs.startsWith("id,name,domain")).toBe(true);
    // deleted rows are included, and formulas are neutralised
    expect(orgs).toContain(`"'=Acme"`);
    expect(orgs).toContain("2026-02-01T00:00:00.000Z");
    // an empty area still has its header
    expect(strFromU8(unzipped["contacts.csv"]).startsWith("id,firstName,lastName,email")).toBe(true);

    const readme = strFromU8(unzipped["README.txt"]);
    expect(readme).toMatch(/cannot restore/);
    expect(readme).toContain("organizations.csv: 1");
    expect(readme).toMatch(/Never added together|never added together/);
  });

  it("asks for deleted rows in every area that has them", async () => {
    await (await post({})).arrayBuffer();
    for (const model of [m.organization, m.contact, m.deal]) {
      expect(model.findMany.mock.calls[0][0].where.AND[0]).toEqual({});
    }
    expect(m.organization.count.mock.calls[0][0].where.AND[0]).toEqual({});
    expect(m.contact.count.mock.calls[0][0].where.AND[0]).toEqual({});
    expect(m.deal.count.mock.calls[0][0].where.AND[0]).toEqual({});
  });

  it("writes one audit entry for the whole export", async () => {
    await (await post({ code: "123456" })).arrayBuffer();
    expect(m.auditLog.create).toHaveBeenCalledTimes(1);
    const data = m.auditLog.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ actorId: "admin-1", action: "EXPORT", entity: "full", ip: "203.0.113.9" });
    expect(data.data).toMatchObject({ format: "zip" });
    expect(Object.keys(data.data.filters.files)).toContain("contacts");
  });

  it("sends nothing and records nothing when the code is wrong", async () => {
    m.stepUp.mockRejectedValue(new ApiError(400, "That code is not right", "BAD_REQUEST"));
    const res = await post({ code: "000000" });
    expect(res.status).toBe(400);
    expect(m.auditLog.create).not.toHaveBeenCalled();
    for (const model of [m.organization, m.contact, m.deal, m.payment]) expect(model.findMany).not.toHaveBeenCalled();
  });

  it("refuses the whole export, rather than cutting a file short, if one area is too big", async () => {
    m.contact.count.mockResolvedValue(500_001);
    const res = await post({ code: "123456" });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("EXPORT_TOO_LARGE");
    expect(body.error).toContain("contacts (500001)");
    expect(m.stepUp).not.toHaveBeenCalled();
    expect(m.auditLog.create).not.toHaveBeenCalled();
  });

  it("is rate limited like every export", async () => {
    m.auditLog.count.mockResolvedValue(5);
    expect((await post({ code: "123456" })).status).toBe(429);
    expect(m.stepUp).not.toHaveBeenCalled();
  });
});
