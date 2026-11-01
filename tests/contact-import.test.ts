import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, headroom } = vi.hoisted(() => ({
  db: { contact: { findMany: vi.fn(), createMany: vi.fn() } },
  headroom: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/plan-limits", () => ({ contactHeadroom: headroom }));

import { importContacts } from "@/lib/contact-import";
import { parseCsv, tableToContacts, MAX_CONTACT_ROWS } from "@/lib/client/contact-import";
import { importContactsSchema } from "@/lib/validations/crm";

const user = { id: "u1", tenantId: "t1", role: "SALES" } as never;
const ada = { firstName: "Ada", lastName: "Okafor", email: "ada@x.test", phone: "+234 803 111 2222", city: "Lagos", state: "", country: "NG" };

beforeEach(() => {
  vi.clearAllMocks();
  headroom.mockResolvedValue(Infinity);
  db.contact.findMany.mockResolvedValue([]);
  db.contact.createMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }));
});

describe("reading a customer sheet in the browser", () => {
  it("maps columns by header name, whatever the order, and splits a single Name column", () => {
    const r = tableToContacts(parseCsv("Phone,Customer Name,E-mail,Town\n+2348031112222,Ada Okafor-Eze,ADA@X.TEST,Lagos\n,Chidi,,Abuja"));
    expect(r.rows).toEqual([
      { firstName: "Ada", lastName: "Okafor-Eze", email: "ada@x.test", phone: "+2348031112222", city: "Lagos", state: "", country: "" },
      { firstName: "Chidi", lastName: "-", email: "", phone: "", city: "Abuja", state: "", country: "" },
    ]);
  });
  it("finds the header below a title row, uses First/Last name columns, and leaves out nameless rows", () => {
    const r = tableToContacts([["My customers"], [], ["First name", "Last name", "Email"], ["Ada", "Okafor", "a@x.test"], ["", "", "orphan@x.test"], [null, null, null]]);
    expect(r.headerRow).toBe(2);
    expect(r.rows).toHaveLength(1);
    expect(r.skipped).toBe(1);
  });
  it("keeps phone numbers read as numbers and stops at 500 rows", () => {
    const table: unknown[][] = [["Name", "Phone"], ["Ada Okafor", 2348031112222]];
    for (let i = 0; i < 600; i++) table.push([`Person ${i}`, ""]);
    const r = tableToContacts(table);
    expect(r.rows[0].phone).toBe("2348031112222");
    expect(r.rows).toHaveLength(MAX_CONTACT_ROWS);
    expect(r.extra).toBe(101);
  });
  it("refuses a sheet with no name column, in words", () => {
    expect(() => tableToContacts([["Email", "Phone"], ["a@x.test", "1"]])).toThrow(/name column/i);
  });
});

describe("the import request", () => {
  it("defaults to customers, needs at least one row and allows at most 500", () => {
    expect(importContactsSchema.parse({ rows: [ada] }).type).toBe("CUSTOMER");
    expect(importContactsSchema.safeParse({ rows: [] }).success).toBe(false);
    expect(importContactsSchema.safeParse({ rows: new Array(501).fill(ada) }).success).toBe(false);
    expect(importContactsSchema.safeParse({ type: "PARTNER", rows: [ada] }).success).toBe(false);
  });
});

describe("importing into a business", () => {
  it("creates the contacts as the caller, in their business, with no consent recorded", async () => {
    const out = await importContacts(user, { type: "CUSTOMER", rows: [ada] });
    expect(out).toMatchObject({ created: 1, skippedCount: 0 });
    const data = db.contact.createMany.mock.calls[0][0].data[0];
    expect(data).toMatchObject({ tenantId: "t1", ownerId: "u1", type: "CUSTOMER", source: "Import", email: "ada@x.test", phoneE164: "+2348031112222" });
    expect(data).not.toHaveProperty("whatsappOptIn");
    expect(data).not.toHaveProperty("emailOptOut");
  });
  it("marks imported leads as new leads", async () => {
    await importContacts(user, { type: "LEAD", rows: [ada] });
    expect(db.contact.createMany.mock.calls[0][0].data[0]).toMatchObject({ type: "LEAD", leadStatus: "NEW" });
  });
  it("skips a bad row with a reason and still imports the rest", async () => {
    const out = await importContacts(user, { type: "CUSTOMER", rows: [{ firstName: "", lastName: "X" }, { ...ada, email: "not-an-email" }, { ...ada, email: "ok@x.test", phone: "" }] });
    expect(out.created).toBe(1);
    expect(out.skipped.map((s) => [s.row, s.reason])).toEqual([[1, "A first and last name are needed"], [2, "The email address is not valid"]]);
  });
  it("skips emails and phone numbers the business already has, and repeats inside the file", async () => {
    db.contact.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => ("email" in where ? [{ email: "have@x.test" }] : "phoneE164" in where ? [{ phoneE164: "+2348039999999" }] : []));
    const out = await importContacts(user, {
      type: "CUSTOMER",
      rows: [
        { ...ada, email: "have@x.test" },
        { ...ada, email: "", phone: "+234 803 999 9999" },
        { ...ada, email: "new@x.test" },
        { ...ada, email: "new@x.test", phone: "" },
      ],
    });
    expect(out.created).toBe(1);
    expect(out.skipped.map((s) => s.reason)).toEqual(["This email already belongs to a contact", "This phone number already belongs to a contact", "Repeated in the file"]);
  });
  it("recognises a row with no email or phone by name, so importing the same list twice does not double it", async () => {
    db.contact.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => ("OR" in where ? [{ firstName: "Tunde", lastName: "Bello" }] : []));
    const bare = (firstName: string, lastName: string) => ({ firstName, lastName, email: "", phone: "", city: "", state: "", country: "" });
    const out = await importContacts(user, { type: "CUSTOMER", rows: [bare("tunde", "bello"), bare("Kemi", "Ade"), bare("Kemi", "Ade")] });
    expect(out.created).toBe(1);
    expect(out.skipped.map((s) => s.reason)).toEqual(["A contact with this name already exists (no email or phone to tell them apart)", "Repeated in the file"]);
  });
  it("looks up existing contacts only inside the callers business", async () => {
    await importContacts(user, { type: "CUSTOMER", rows: [ada] });
    for (const call of db.contact.findMany.mock.calls) expect(call[0].where.tenantId).toBe("t1");
  });
  it("stops at the plan contact limit and says so for the rest", async () => {
    headroom.mockResolvedValue(2);
    const rows = [1, 2, 3, 4].map((n) => ({ ...ada, email: `p${n}@x.test`, phone: "" }));
    const out = await importContacts(user, { type: "CUSTOMER", rows });
    expect(out.created).toBe(2);
    expect(out.skipped.map((s) => s.reason)).toEqual(["Your plan's contact limit is reached", "Your plan's contact limit is reached"]);
  });
  it("counts a row another person added a moment ago as skipped, not created", async () => {
    db.contact.createMany.mockResolvedValue({ count: 0 });
    const out = await importContacts(user, { type: "CUSTOMER", rows: [ada] });
    expect(out).toMatchObject({ created: 0, skippedCount: 1 });
  });
});
