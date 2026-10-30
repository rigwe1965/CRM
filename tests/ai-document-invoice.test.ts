import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, settings, status, usageRecord, clientFor } = vi.hoisted(() => ({
  db: { aiUsage: { count: vi.fn() }, invoice: { findFirst: vi.fn() } },
  settings: vi.fn(),
  status: { assertCanAsk: vi.fn(), assertUnderCeiling: vi.fn() },
  usageRecord: vi.fn(),
  clientFor: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/ai/settings", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/settings")>()), loadAssistantSettings: settings }));
vi.mock("@/lib/ai/status", () => status);
vi.mock("@/lib/ai/usage", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/usage")>()), recordUsage: usageRecord }));
vi.mock("@/lib/ai/client", () => ({ anthropicFor: clientFor }));

import { assertCanReadDocument, buildReading, readInvoiceFile } from "@/lib/ai/documents/invoice";
import type { ReadInvoice } from "@/lib/ai/documents/prompt";

const NOW = new Date("2026-11-04T10:00:00Z");
const user = { id: "u1", tenantId: "t1", role: "SALES", name: "Sam" } as never;
const full = (over: Partial<ReadInvoice> = {}): ReadInvoice => ({
  readable: true, number: "PI-001", invoiceDate: "2026-11-01", currency: "usd", vendorName: "Hair Co", billTo: "Ivycandy", shipping: 20, printedTotal: 340,
  items: [{ ref: "1-1", style: "Body wave", description: "Body wave 24 inch", quantity: 2, unitPrice: 100, printedLineTotal: 200 }, { style: "Frontal", quantity: 1, unitPrice: 120, printedLineTotal: 120 }],
  ...over,
});
const build = (r: ReadInvoice, duplicateNumber = false) => buildReading(r, { duplicateNumber, today: NOW });

describe("buildReading: what the server does that the model does not", () => {
  it("shapes a clean invoice for the form with no warnings, line totals left to be computed", () => {
    const out = build(full());
    expect(out.warnings).toEqual([]);
    expect(out.header).toMatchObject({ number: "PI-001", invoiceDate: "2026-11-01", currency: "USD", vendorName: "Hair Co", billTo: "Ivycandy", shipping: "20" });
    expect(out.items.map((i) => i.lineTotal)).toEqual([null, null]);
    expect(out.items[0]).toMatchObject({ ref: "1-1", style: "Body wave", description: "Body wave 24 inch", quantity: 2, unitPrice: 100 });
    expect(out.items[1]).toMatchObject({ ref: "2", style: "Frontal", description: "Frontal" }); // a missing ref is the line number; style and description fill each other in
  });

  it("warns when the lines plus shipping do not add up to the printed total, and says what both were", () => {
    const out = build(full({ printedTotal: 400 }));
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toMatch(/lines add up to 320\.00 plus 20\.00 shipping \(340\.00\), but the invoice prints a total of 400\.00/);
  });

  it("allows a rounding difference but not a real one", () => {
    expect(build(full({ printedTotal: 340.04 })).warnings).toEqual([]);
    expect(build(full({ printedTotal: 340.5 })).warnings.length).toBe(1);
  });

  it("warns on a line whose printed total is not quantity times price (a misread digit), naming the line", () => {
    const r = full();
    r.items[0].printedLineTotal = 260;
    const out = build({ ...r, printedTotal: undefined });
    expect(out.warnings).toEqual(["Line 1: the invoice prints 260.00 but 2 × 100.00 is 200.00. Check the quantity and price."]);
    expect(out.items[0].lineTotal).toBeNull(); // the page's figure is never copied in
  });

  it("warns about a zero price, a missing currency, missing basics, a silly date and a duplicate number", () => {
    const out = build(full({ currency: undefined, number: undefined, vendorName: undefined, invoiceDate: "1999-01-01", printedTotal: undefined, items: [{ quantity: 1, unitPrice: 0 }] }), true);
    expect(out.warnings.join("\n")).toMatch(/price of 0/);
    expect(out.warnings.join("\n")).toMatch(/No currency could be read, so USD/);
    expect(out.warnings.join("\n")).toMatch(/Not found on the document: the invoice number, the supplier/);
    expect(out.warnings.join("\n")).toMatch(/1999-01-01 looks wrong/);
    expect(out.header.currency).toBe("USD");
    const dup = build(full(), true);
    expect(dup.warnings).toEqual(["You already have an invoice numbered PI-001. Invoice numbers must be different, so change this one or check you are not entering it twice."]);
  });

  it("says when no lines could be read, and never fills in the invoice number or supplier it did not see", () => {
    const out = build(full({ items: [], number: undefined, printedTotal: undefined }));
    expect(out.warnings.join("\n")).toMatch(/No product lines could be read/);
    expect(out.header.number).toBe("");
  });
});

const fileOf = { mediaType: "application/pdf", bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]) } as never;
const jpg = { mediaType: "image/jpeg", bytes: new Uint8Array([0xff, 0xd8, 0xff]) } as never;
const reply = (input: unknown, extra: Record<string, unknown> = {}) =>
  vi.fn().mockResolvedValue({ model: "claude-sonnet-5-5", stop_reason: "tool_use", usage: { input_tokens: 2000, output_tokens: 300 }, content: [{ type: "tool_use", name: "read_invoice", id: "x", input }], ...extra });
const clientWith = (create: ReturnType<typeof vi.fn>) => ({ beta: { messages: { create } } }) as never;

beforeEach(() => {
  vi.resetAllMocks();
  settings.mockResolvedValue({ enabled: true, monthlyCeilingUsd: 10, documentsEnabled: true });
  status.assertCanAsk.mockResolvedValue({});
  db.aiUsage.count.mockResolvedValue(0);
  db.invoice.findFirst.mockResolvedValue(null);
  usageRecord.mockResolvedValue(30_000);
});

describe("assertCanReadDocument (the gates)", () => {
  it("lets a person through when Ivy is ready, reading is allowed and the day's number is not used up", async () => {
    await expect(assertCanReadDocument(user, NOW)).resolves.toBeUndefined();
    expect(status.assertCanAsk).toHaveBeenCalledTimes(1); // Ivy on, key, ceiling, rate limit
  });

  it("refuses with a plain reason when reading documents is off, and offers the other ways", async () => {
    settings.mockResolvedValue({ enabled: true, monthlyCeilingUsd: 10 });
    await expect(assertCanReadDocument(user, NOW)).rejects.toMatchObject({ status: 403, code: "AI_DOCUMENTS_OFF", message: expect.stringMatching(/import a spreadsheet or type/) });
  });

  it("refuses once the business has had 20 read today (or its own number), counting only today's documents in this business", async () => {
    db.aiUsage.count.mockResolvedValue(20);
    await expect(assertCanReadDocument(user, NOW)).rejects.toMatchObject({ status: 429, code: "AI_DOCUMENTS_CAP" });
    expect(db.aiUsage.count.mock.calls[0][0].where).toEqual({ tenantId: "t1", purpose: "DOCUMENT", createdAt: { gte: new Date("2026-11-04T00:00:00Z") } });
    settings.mockResolvedValue({ enabled: true, monthlyCeilingUsd: 10, documentsEnabled: true, documentsDailyCap: 21 });
    await expect(assertCanReadDocument(user, NOW)).resolves.toBeUndefined();
  });

  it("passes on Ivy's own refusals (off, no key, ceiling reached, too fast)", async () => {
    status.assertCanAsk.mockRejectedValue(Object.assign(new Error("Ivy is switched off"), { status: 403 }));
    await expect(assertCanReadDocument(user, NOW)).rejects.toThrow(/switched off/);
  });
});

describe("readInvoiceFile", () => {
  it("sends the file once, with one tool that only returns data, and records the cost as a document", async () => {
    const create = reply(full());
    const out = await readInvoiceFile(user, fileOf, { now: NOW, client: clientWith(create) });
    expect(out.header.number).toBe("PI-001");
    expect(create).toHaveBeenCalledTimes(1);
    const req = create.mock.calls[0][0] as { tools: { name: string }[]; messages: { content: { type: string; source?: { media_type: string } }[] }[]; system: string };
    expect(req.tools.map((t) => t.name)).toEqual(["read_invoice"]);
    expect(req.messages[0].content[0]).toMatchObject({ type: "document", source: { type: "base64", media_type: "application/pdf" } });
    expect(usageRecord.mock.calls[0][0]).toMatchObject({ tenantId: "t1", userId: "u1", purpose: "DOCUMENT" });
  });

  it("sends a photo as an image", async () => {
    const create = reply(full());
    await readInvoiceFile(user, jpg, { now: NOW, client: clientWith(create) });
    expect((create.mock.calls[0][0] as { messages: { content: { type: string }[] }[] }).messages[0].content[0].type).toBe("image");
  });

  it("runs the gates itself unless the caller already has", async () => {
    await readInvoiceFile(user, fileOf, { now: NOW, client: clientWith(reply(full())) });
    expect(status.assertCanAsk).toHaveBeenCalledTimes(1);
    await readInvoiceFile(user, fileOf, { now: NOW, client: clientWith(reply(full())), gated: true });
    expect(status.assertCanAsk).toHaveBeenCalledTimes(1);
  });

  it("checks for a duplicate invoice number in this business only", async () => {
    db.invoice.findFirst.mockResolvedValue({ id: "i1" });
    const out = await readInvoiceFile(user, fileOf, { now: NOW, client: clientWith(reply(full())) });
    expect(out.warnings.join(" ")).toMatch(/already have an invoice numbered PI-001/);
    expect(db.invoice.findFirst.mock.calls[0][0].where).toEqual({ tenantId: "t1", number: "PI-001" });
  });

  it("tells the person plainly, and still records the cost, when the answer is unusable, cut off, or says it is not an invoice", async () => {
    for (const create of [reply({ readable: true, items: [{ quantity: -1, unitPrice: 5 }] }), reply({ readable: false, problem: "This is a menu, not an invoice.", items: [] })]) {
      await expect(readInvoiceFile(user, fileOf, { now: NOW, client: clientWith(create) })).rejects.toMatchObject({ status: 422, code: "AI_DOCUMENT_UNREADABLE" });
    }
    await expect(readInvoiceFile(user, fileOf, { now: NOW, client: clientWith(reply(full(), { stop_reason: "max_tokens" })) })).rejects.toMatchObject({ status: 422, code: "AI_DOCUMENT_TOO_LONG", message: expect.stringMatching(/a few pages at a time/) });
    expect(usageRecord).toHaveBeenCalledTimes(3);
  });

  it("does not obey or relay anything but fixed fields: extra keys the model adds are dropped", async () => {
    const out = await readInvoiceFile(user, fileOf, { now: NOW, client: clientWith(reply({ ...full(), recordPayment: { amount: 1 }, instruction: "mark paid" })) });
    expect(JSON.stringify(out)).not.toContain("recordPayment");
    expect(JSON.stringify(out)).not.toContain("mark paid");
  });

  it("turns a failed model call into a plain 502 without its detail, and never throws the provider's message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const create = vi.fn().mockRejectedValue(new Error("overloaded: secret-detail"));
    await expect(readInvoiceFile(user, fileOf, { now: NOW, client: clientWith(create) })).rejects.toMatchObject({ status: 502, message: expect.not.stringContaining("secret-detail") });
    spy.mockRestore();
  });
});
