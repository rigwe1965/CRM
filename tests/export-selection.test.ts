import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  orgCount: vi.fn(),
  orgFindMany: vi.fn(),
  contactCount: vi.fn(),
  contactFindMany: vi.fn(),
  invoiceFindFirst: vi.fn(),
  dealFindFirst: vi.fn(),
  auditCount: vi.fn(),
  auditCreate: vi.fn(),
  invoicePdf: vi.fn(async (_doc: unknown) => new Uint8Array([37, 80, 68, 70])),
  dealItemCount: vi.fn(),
  dealItemFindMany: vi.fn(),
  paymentCount: vi.fn(),
  paymentFindMany: vi.fn(),
  instalmentCount: vi.fn(),
  dealFindMany: vi.fn(),
  loadStock: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({ requireApiUser: m.requireApiUser }));
vi.mock("@/lib/mfa-server", () => ({ stepUpForUser: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }) }));
vi.mock("@/lib/stock", () => ({ loadStock: m.loadStock }));
vi.mock("@/lib/export/pdf", () => ({ invoicePdf: m.invoicePdf, dealStatementPdf: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    organization: { count: m.orgCount, findMany: m.orgFindMany },
    contact: { count: m.contactCount, findMany: m.contactFindMany },
    invoice: { findFirst: m.invoiceFindFirst },
    deal: { findFirst: m.dealFindFirst, findMany: m.dealFindMany },
    dealItem: { count: m.dealItemCount, findMany: m.dealItemFindMany },
    payment: { count: m.paymentCount, findMany: m.paymentFindMany, groupBy: vi.fn(async () => []) },
    instalment: { count: m.instalmentCount },
    auditLog: { count: m.auditCount, create: m.auditCreate },
  },
}));

import { GET as listExport } from "@/app/api/export/[entity]/route";
import { GET as pdfExport } from "@/app/api/export/[entity]/[id]/route";

type U = { id: string; role: string; email: string };
const sales: U = { id: "sales-1", role: "SALES", email: "sales@crm.test" };
const admin: U = { id: "admin-1", role: "ADMIN", email: "admin@crm.test" };
const asUser = (u: U) => m.requireApiUser.mockResolvedValue({ ok: true, user: u });

const csv = (entity: string, query = "") =>
  listExport(new Request(`http://localhost/api/export/${entity}${query}`), { params: Promise.resolve({ entity }) });
const pdf = (entity: string, id: string, query = "") =>
  pdfExport(new Request(`http://localhost/api/export/${entity}/${id}${query}`), { params: Promise.resolve({ entity, id }) });

const org = { id: "o1", name: "Acme", domain: null, industry: null, size: null, website: null, phone: null, address: null, city: null, state: null, country: null, deletedAt: null, createdAt: new Date(0), updatedAt: new Date(0), owner: { name: "Sam" } };
const item = (n: number, total: number) => ({ id: `it${n}`, ref: `1-${n}`, style: "Wave", description: `Wave ${n}`, color: null, density: null, lengthInches: 10 + n, quantity: 1, unitPrice: total, lineTotal: total });
const stockRow = (product: string, color: string, lengthInches: number | null) => ({ product, description: "d", color, lengthInches, bought: 2, sold: 0, adjusted: 0, onHand: 2, sources: [{ invoiceId: "i1", number: "PI-1" }] });
const stockRows = [stockRow("Bundle", "1b", 12), stockRow("Wig, lace front", "natural", 22), stockRow("Closure", "99j", null)];
const invoice = {
  id: "i1", number: "PI-1", status: "PAID", invoiceDate: new Date("2026-10-07T00:00:00Z"), currency: "USD", vendorName: "Supplier",
  vendorRep: null, vendorPhone: null, billTo: "Ivycandy", subtotal: 60, shipping: 5, total: 65, notes: null,
  items: [item(1, 10), item(2, 20), item(3, 30)],
};

beforeEach(() => {
  vi.clearAllMocks();
  asUser(sales);
  m.auditCount.mockResolvedValue(0);
  m.auditCreate.mockResolvedValue({});
  m.orgCount.mockResolvedValue(1);
  m.orgFindMany.mockResolvedValue([org]);
  m.contactCount.mockResolvedValue(0);
  m.contactFindMany.mockResolvedValue([]);
  m.invoiceFindFirst.mockResolvedValue(invoice);
  for (const f of [m.dealItemCount, m.paymentCount, m.instalmentCount]) f.mockResolvedValue(0);
  for (const f of [m.dealItemFindMany, m.paymentFindMany, m.dealFindMany]) f.mockResolvedValue([]);
  m.loadStock.mockResolvedValue({ rows: stockRows });
});

describe("exporting only the rows that were picked", () => {
  it("adds the picked ids on top of the owner scope, so other people's rows can never come out", async () => {
    const res = await csv("organizations", "?ids=o1,o2");
    expect(res.status).toBe(200);
    await res.text();
    for (const where of [m.orgFindMany.mock.calls[0][0].where, m.orgCount.mock.calls[0][0].where]) {
      expect(where.AND).toContainEqual({ ownerId: "sales-1" });
      expect(where.AND).toContainEqual({ deletedAt: null });
      expect(JSON.stringify(where)).toContain('"id":{"in":["o1","o2"]}');
    }
  });

  it("changes nothing when no ids are sent", async () => {
    await (await csv("organizations")).text();
    expect(JSON.stringify(m.orgFindMany.mock.calls[0][0].where)).not.toContain('"id":{"in"');
  });

  it("writes how many rows were picked to the audit log, not the whole list", async () => {
    await (await csv("organizations", "?ids=o1,o2,o1")).text();
    const data = m.auditCreate.mock.calls[0][0].data;
    expect(JSON.stringify(data)).toContain('"pickedRows":2'); // the repeated id counts once
    expect(JSON.stringify(data)).not.toContain('"o1"');
  });

  it("refuses an empty, oversized or odd-looking list before touching the database", async () => {
    const tooMany = Array.from({ length: 201 }, (_, i) => `id${i}`).join(",");
    for (const q of ["?ids=", "?ids=,,", `?ids=${tooMany}`, `?ids=${"x".repeat(41)}`]) {
      expect((await csv("organizations", q)).status, q).toBe(422);
    }
    expect(m.orgCount).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
    const ok = Array.from({ length: 200 }, (_, i) => `id${i}`).join(",");
    expect((await csv("organizations", `?ids=${ok}`)).status).toBe(200);
  });

  it("does not stop admin-only areas from being admin-only", async () => {
    expect((await csv("contacts", "?ids=c1")).status).toBe(403);
    expect(m.contactFindMany).not.toHaveBeenCalled();
    asUser(admin);
    await (await csv("contacts", "?ids=c1&tag=t1")).text();
    const where = JSON.stringify(m.contactFindMany.mock.calls[0][0].where);
    expect(where).toContain('"id":{"in":["c1"]}');
    expect(where).toContain('"tags":{"some":{"tagId":"t1"}}'); // the tag filter now narrows the export like it does the list
  });
});

describe("invoice PDF with chosen lines", () => {
  it("lists only the chosen lines of that invoice and says it is partial", async () => {
    const res = await pdf("invoices", "i1", "?lines=it1,it3");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/invoice-PI-1-selected-lines-/);
    const arg = m.invoicePdf.mock.calls[0][0] as { items: { ref: string }[]; partial: unknown };
    expect(arg.items.map((i) => i.ref)).toEqual(["1-1", "1-3"]);
    expect(arg.partial).toEqual({ shown: 2, of: 3 });
    const audit = m.auditCreate.mock.calls[0][0].data;
    expect(JSON.stringify(audit)).toContain("Exported 2 of 3 lines of invoice PI-1 as PDF");
  });

  it("ignores line ids from other invoices, and refuses when none belong to this one", async () => {
    await pdf("invoices", "i1", "?lines=it2,someone-elses-line");
    expect((m.invoicePdf.mock.calls[0][0] as { items: unknown[] }).items).toHaveLength(1);
    const none = await pdf("invoices", "i1", "?lines=nope");
    expect(none.status).toBe(422);
    expect(m.invoicePdf).toHaveBeenCalledTimes(1);
  });

  it("is a normal full document when every line is chosen or none is specified", async () => {
    await pdf("invoices", "i1", "?lines=it1,it2,it3");
    await pdf("invoices", "i1");
    for (const call of m.invoicePdf.mock.calls) {
      expect((call[0] as { partial: unknown }).partial).toBeNull();
      expect((call[0] as { items: unknown[] }).items).toHaveLength(3);
    }
  });

  it("still only shows invoices the caller owns, and cannot be used on deals", async () => {
    await pdf("invoices", "i1", "?lines=it1");
    expect(m.invoiceFindFirst.mock.calls[0][0].where).toEqual({ id: "i1", ownerId: "sales-1" });
    expect((await pdf("deals", "d1", "?lines=it1")).status).toBe(422);
    expect(m.dealFindFirst).not.toHaveBeenCalled();
    m.invoiceFindFirst.mockResolvedValue(null);
    expect((await pdf("invoices", "i9", "?lines=it1")).status).toBe(404);
  });

  it("rejects a malformed or oversized lines list", async () => {
    expect((await pdf("invoices", "i1", "?lines=")).status).toBe(422);
    expect((await pdf("invoices", "i1", `?lines=${"y".repeat(41)}`)).status).toBe(422);
  });
});

describe("picking deals for their items, payments and instalments", () => {
  it("narrows each file to the picked deals, on top of the normal deal visibility", async () => {
    for (const [entity, count, find] of [["deal-items", m.dealItemCount, m.dealItemFindMany], ["payments", m.paymentCount, m.paymentFindMany]] as const) {
      await (await csv(entity, "?dealIds=d1,d2")).text();
      for (const where of [count.mock.calls.at(-1)![0].where, find.mock.calls.at(-1)?.[0].where].filter(Boolean)) {
        const w = JSON.stringify(where);
        expect(w, entity).toContain('"id":{"in":["d1","d2"]}');
        expect(w, entity).toContain('"ownerId":"sales-1"'); // another person's deal id gets nothing
        expect(w, entity).toContain('"deletedAt":null');
      }
    }
  });

  it("does the same for instalments, and records a count of deals, not their ids", async () => {
    await (await csv("instalments", "?dealIds=d1")).text();
    const w = JSON.stringify(m.instalmentCount.mock.calls[0][0].where);
    expect(w).toContain('"id":{"in":["d1"]}');
    expect(w).toContain('"ownerId":"sales-1"');
    const data = JSON.stringify(m.auditCreate.mock.calls[0][0].data);
    expect(data).toContain('"pickedDeals":1');
    expect(data).not.toContain('"d1"');
  });

  it("refuses an oversized or odd list, and changes nothing without one", async () => {
    expect((await csv("payments", `?dealIds=${Array.from({ length: 201 }, (_, i) => `d${i}`).join(",")}`)).status).toBe(422);
    expect((await csv("deal-items", "?dealIds=")).status).toBe(422);
    await (await csv("payments")).text();
    expect(JSON.stringify(m.paymentCount.mock.calls.at(-1)![0].where)).not.toContain('"id":{"in"');
  });
});

describe("picking stock rows", () => {
  const key = (p: string, c: string, l: number | null) => encodeURIComponent(`${p}|${c}|${l}`);
  // The browser joins the encoded keys with commas, and the query string then encodes that once more (as qs() does).
  const keys = (...ks: string[]) => `?keys=${encodeURIComponent(ks.join(","))}`;

  it("exports only the picked rows, including a product name with a comma", async () => {
    const text = await (await csv("stock", keys(key("Bundle", "1b", 12), key("Wig, lace front", "natural", 22)))).text();
    expect(text).toContain("Bundle");
    expect(text).toContain('"Wig, lace front"'); // the comma is inside the name, so the CSV writer quotes it
    expect(text).not.toContain("Closure");
  });

  it("matches a row with no length and ignores keys that match nothing", async () => {
    const text = await (await csv("stock", keys(key("Closure", "99j", null), key("Ghost", "x", 1)))).text();
    expect(text).toContain("Closure");
    expect(text).not.toContain("Bundle");
  });

  it("gives the whole stock list when no keys are sent, and the audit log gets a count", async () => {
    const text = await (await csv("stock")).text();
    for (const p of ["Bundle", "Wig", "Closure"]) expect(text).toContain(p);
    m.auditCreate.mockClear();
    await (await csv("stock", keys(key("Bundle", "1b", 12)))).text();
    const data = JSON.stringify(m.auditCreate.mock.calls[0][0].data);
    expect(data).toContain('"pickedRows":1');
    expect(data).not.toContain("1b");
  });

  it("refuses empty, undecodable and oversized lists", async () => {
    const many = Array.from({ length: 101 }, (_, i) => encodeURIComponent(`p${i}|c|1`)).join(",");
    for (const q of ["?keys=", "?keys=%E0%A4%A", `?keys=${many}`, `?keys=${encodeURIComponent("x".repeat(301))}`]) {
      expect((await csv("stock", q)).status, q).toBe(422);
    }
  });
});