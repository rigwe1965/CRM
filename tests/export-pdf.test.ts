import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  dealFindFirst: vi.fn(),
  invoiceFindFirst: vi.fn(),
  paymentFindMany: vi.fn(),
  instalmentFindMany: vi.fn(),
  auditCount: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({ requireApiUser: m.requireApiUser }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }) }));
vi.mock("@/lib/db", () => ({
  db: {
    deal: { findFirst: m.dealFindFirst },
    invoice: { findFirst: m.invoiceFindFirst },
    payment: { findMany: m.paymentFindMany },
    instalment: { findMany: m.instalmentFindMany },
    auditLog: { count: m.auditCount, create: m.auditCreate },
  },
}));

import { GET } from "@/app/api/export/[entity]/[id]/route";
import { dealStatementPdf, invoicePdf, type DealStatement, type InvoiceDocument } from "@/lib/export/pdf";

const sales = { id: "sales-1", role: "SALES", email: "sales@crm.test" };
const get = (entity: string, id: string, query = "") =>
  GET(new Request(`http://localhost/api/export/${entity}/${id}${query}`), { params: Promise.resolve({ entity, id }) });
const looksLikePdf = (b: Uint8Array) =>
  Buffer.from(b.slice(0, 5)).toString() === "%PDF-" && Buffer.from(b.slice(-16)).toString().includes("%%EOF");

describe("PDF builders", () => {
  const base: DealStatement = {
    generatedAt: new Date("2026-10-20T00:00:00Z"),
    deal: { title: "Nguyễn Thị Hương – 5 bundles", stage: "CLOSED_WON", currency: "NGN", amount: 250000.5, customer: "Ọlá Adéwálé", organization: "Acme <b>Ltd</b>", owner: "Sam" },
    items: [{ productType: "Bone straight", texture: "Straight", lengthInches: "18", color: "1B", laceType: null, quantity: 2, unitPrice: 50000.25 }],
    payments: [{ paidAt: new Date("2026-10-01T00:00:00Z"), method: "BANK_TRANSFER", reference: "REF-1", amount: 100000 }],
    instalments: [{ position: 1, dueDate: new Date("2026-10-15T00:00:00Z"), amount: 150000, covered: 0, overdue: true }],
    paid: 100000,
    balance: 150000.5,
  };

  it("makes a valid deal statement", async () => {
    expect(looksLikePdf(await dealStatementPdf(base))).toBe(true);
  });

  it("copes with accents, markup, control characters, emoji and very long text", async () => {
    const nasty = "=1+1 <script>alert(1)</script> \u0000\u0007\u001b 😀 " + "x".repeat(5000);
    const bytes = await dealStatementPdf({
      ...base,
      deal: { ...base.deal, title: nasty, customer: nasty, organization: nasty },
      payments: [{ ...base.payments[0], reference: nasty }],
    });
    expect(looksLikePdf(bytes)).toBe(true);
  });

  it("runs onto more pages when there are many lines", async () => {
    const one = await dealStatementPdf(base);
    const many = await dealStatementPdf({
      ...base,
      payments: Array.from({ length: 300 }, (_, i) => ({ paidAt: new Date(2026, 0, 1 + (i % 28)), method: "CASH", reference: `R${i}`, amount: 10 })),
    });
    expect(looksLikePdf(many)).toBe(true);
    expect(many.length).toBeGreaterThan(one.length);
  });

  it("makes a valid invoice, with or without notes and items", async () => {
    const inv: InvoiceDocument = {
      generatedAt: new Date("2026-10-20T00:00:00Z"),
      invoice: { number: "INV-001", status: "SENT", invoiceDate: new Date("2026-09-01T00:00:00Z"), currency: "USD", vendorName: "Supplier Co", vendorRep: "Lan", vendorPhone: "+84 90", billTo: "Ivycandy", subtotal: 100, shipping: 10, total: 110, notes: "Pay within 7 days\nThanks" },
      items: [{ ref: "1-1", style: "Bone", description: "Bone straight 18in", color: "1B", density: "180%", lengthInches: 18, quantity: 2, unitPrice: 50, lineTotal: 100 }],
    };
    expect(looksLikePdf(await invoicePdf(inv))).toBe(true);
    expect(looksLikePdf(await invoicePdf({ ...inv, invoice: { ...inv.invoice, notes: null }, items: [] }))).toBe(true);
  });

  it("makes a valid partial invoice, which prints the lines' own subtotal instead of the invoice total", async () => {
    const inv: InvoiceDocument = {
      generatedAt: new Date("2026-10-20T00:00:00Z"),
      invoice: { number: "INV-002", status: "PAID", invoiceDate: new Date("2026-09-01T00:00:00Z"), currency: "USD", vendorName: "Supplier Co", vendorRep: null, vendorPhone: null, billTo: "Ivycandy", subtotal: 300, shipping: 10, total: 310, notes: null },
      items: [{ ref: "1-1", style: "Bone", description: "Bone straight 18in", color: null, density: null, lengthInches: 18, quantity: 1, unitPrice: 100, lineTotal: 100 }],
      partial: { shown: 1, of: 3 },
    };
    const bytes = await invoicePdf(inv);
    expect(looksLikePdf(bytes)).toBe(true);
    expect(bytes.length).toBeGreaterThan(1000);
  });
});

describe("GET /api/export/:entity/:id (PDF)", () => {
  const deal = {
    id: "d1", title: 'Ada "x"; ../é', stage: "CLOSED_WON", amount: 100, currency: "NGN",
    organization: { name: "Acme" }, contact: { firstName: "Nguyễn", lastName: "Hương" }, owner: { name: "Sam" },
    items: [{ productType: "Bone straight", texture: null, lengthInches: "18", color: "1B", laceType: null, quantity: 2, unitPrice: 50 }],
  };
  const invoice = {
    id: "i1", number: "INV/001 <x>", status: "SENT", invoiceDate: new Date("2026-09-01T00:00:00Z"), currency: "USD", vendorName: "Supplier",
    vendorRep: null, vendorPhone: null, billTo: "Ivycandy", subtotal: 100, shipping: 0, total: 100, notes: null,
    items: [{ ref: "1", style: "Bone", description: "d", color: null, density: null, lengthInches: 18, quantity: 2, unitPrice: 50, lineTotal: 100 }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    m.requireApiUser.mockResolvedValue({ ok: true, user: sales });
    m.auditCount.mockResolvedValue(0);
    m.auditCreate.mockResolvedValue({});
    m.dealFindFirst.mockResolvedValue(deal);
    m.invoiceFindFirst.mockResolvedValue(invoice);
    m.paymentFindMany.mockResolvedValue([{ id: "p1", amount: 40, paidAt: new Date("2026-10-01T00:00:00Z"), method: "CASH", reference: null, note: null, recordedBy: { id: "u", name: "Sam" } }]);
    m.instalmentFindMany.mockResolvedValue([]);
  });

  it("rejects signed-out callers", async () => {
    m.requireApiUser.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await get("deals", "d1")).status).toBe(401);
  });

  it("only knows deals and invoices", async () => {
    for (const e of ["organizations", "contacts", "constructor"]) expect((await get(e, "x1")).status, e).toBe(404);
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("makes a deal statement for a deal the caller can see, with a safe file name", async () => {
    const res = await get("deals", "d1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="deal-statement-[A-Za-z0-9._-]+-\d{4}-\d{2}-\d{2}\.pdf"$/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(looksLikePdf(new Uint8Array(await res.arrayBuffer()))).toBe(true);
    // scope: the caller's own, live deals only
    expect(m.dealFindFirst.mock.calls[0][0].where).toEqual({ id: "d1", deletedAt: null, ownerId: "sales-1" });
    // audit first, with who and what
    expect(m.auditCreate).toHaveBeenCalledTimes(1);
    expect(m.auditCreate.mock.calls[0][0].data).toMatchObject({ actorId: "sales-1", action: "EXPORT", entity: "deals", ip: "203.0.113.9" });
    expect(m.auditCreate.mock.calls[0][0].data.data).toMatchObject({ format: "pdf", filters: { id: "d1" } });
  });

  it("404s, records nothing and sends nothing for a deal the caller cannot see", async () => {
    m.dealFindFirst.mockResolvedValue(null);
    expect((await get("deals", "someone-elses")).status).toBe(404);
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("makes an invoice and never asks the database for resale prices", async () => {
    const res = await get("invoices", "i1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="invoice-INV_001_x_-\d{4}-\d{2}-\d{2}\.pdf"$/);
    expect(looksLikePdf(new Uint8Array(await res.arrayBuffer()))).toBe(true);
    const select = m.invoiceFindFirst.mock.calls[0][0].select;
    expect(select.items.select).not.toHaveProperty("resalePrice");
    expect(m.invoiceFindFirst.mock.calls[0][0].where).toEqual({ id: "i1", ownerId: "sales-1" });
  });

  it("refuses a document that is too long", async () => {
    m.paymentFindMany.mockResolvedValue(Array.from({ length: 2001 }, (_, i) => ({ id: `p${i}`, amount: 1, paidAt: new Date(0), method: "CASH", reference: null, note: null, recordedBy: { id: "u", name: "S" } })));
    const res = await get("deals", "d1");
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("EXPORT_TOO_LARGE");
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("is rate limited", async () => {
    m.auditCount.mockResolvedValue(5);
    expect((await get("deals", "d1")).status).toBe(429);
    expect(m.dealFindFirst).not.toHaveBeenCalled();
  });

  it("only makes PDFs, and rejects odd ids", async () => {
    expect((await get("deals", "d1", "?format=csv")).status).toBe(422);
    expect((await get("deals", "x".repeat(60))).status).toBe(422);
  });
});
