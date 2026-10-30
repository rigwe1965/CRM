import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, actions, pay, dup, plan, view } = vi.hoisted(() => ({
  db: {
    contact: { findFirst: vi.fn() },
    organization: { findFirst: vi.fn() },
    deal: { findFirst: vi.fn() },
    payment: { findFirst: vi.fn() },
    paymentLink: { findFirst: vi.fn() },
  },
  actions: { createTask: vi.fn(), updateTask: vi.fn(), logActivity: vi.fn(), changeDealStage: vi.fn(), createContact: vi.fn(), createDeal: vi.fn() },
  pay: { recordPayment: vi.fn() },
  dup: { findDuplicates: vi.fn() },
  plan: { assertWithinPlan: vi.fn() },
  view: { dealPaymentsView: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/crm-actions", () => actions);
vi.mock("@/lib/record-payment", () => pay);
vi.mock("@/lib/duplicates", () => dup);
vi.mock("@/lib/plan-limits", () => plan);
vi.mock("@/lib/payments", async (orig) => ({ ...(await orig<typeof import("@/lib/payments")>()), dealPaymentsView: view.dealPaymentsView }));

import { ApiError } from "@/lib/api";
import { ToolError } from "@/lib/ai/tools/types";
import { KINDS } from "@/lib/ai/proposal-kinds";

const sales = { id: "u-sales", tenantId: "t1", role: "SALES", name: "Sam" } as never;
type Out = { params: Record<string, unknown>; preview: { title: string; lines: { label: string; value: string }[]; warning?: string; confirm?: { button: string; message: string } } };
const prepare = (kind: keyof typeof KINDS, raw: unknown) => (KINDS[kind].prepare as unknown as (u: never, r: unknown) => Promise<Out>)(sales, raw);
const line = (out: Out, label: string) => out.preview.lines.find((l) => l.label === label)?.value;
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const deal = { id: "d1", title: "Wholesale Bundles", amount: "1200", currency: "USD", contact: { firstName: "Adaeze", lastName: "Okafor" } };
const instalments = (covered: number[]) => [1, 2, 3].map((n, i) => ({ id: `i${n}`, position: n, dueDate: new Date(`2026-10-${10 + n * 5}`), amount: 400, covered: covered[i], overdue: false }));

beforeEach(() => {
  vi.resetAllMocks();
  db.deal.findFirst.mockResolvedValue(deal);
  db.payment.findFirst.mockResolvedValue(null);
  db.paymentLink.findFirst.mockResolvedValue(null);
  db.contact.findFirst.mockResolvedValue({ firstName: "Adaeze", lastName: "Okafor" });
  view.dealPaymentsView.mockResolvedValue({ dealAmount: 1200, currency: "USD", summary: { paid: 400, balance: 800 }, instalments: instalments([400, 0, 0]) });
  dup.findDuplicates.mockResolvedValue([]);
});

describe("PAYMENT_RECORD", () => {
  it("builds the card from the server's figures: amount, balance before and after, the instalment it clears", async () => {
    const out = await prepare("PAYMENT_RECORD", { dealId: "d1", amount: 400, method: "BANK_TRANSFER", reference: "TRX-9" });
    expect(line(out, "Customer")).toBe("Adaeze Okafor");
    expect(line(out, "Amount")).toBe("400.00 USD");
    expect(line(out, "Balance")).toBe("800.00 → 400.00 USD");
    expect(line(out, "Clears")).toBe("No. 2 due 2026-10-20: 400.00 of 400.00 covered");
    expect(out.preview.confirm?.button).toBe("Record 400.00 USD");
    expect(out.preview.confirm?.message).toContain("takes 800.00 USD down to 400.00 USD");
    expect(out.params).toEqual({ dealId: "d1", amount: 400, paidAt: day(0), method: "BANK_TRANSFER", reference: "TRX-9", note: null, expect: { paid: 400 } });
    expect(out.preview.warning).toBeUndefined();
  });

  it("reads the deal through the person's own scope, and records nothing", async () => {
    await prepare("PAYMENT_RECORD", { dealId: "d1", amount: 100 });
    expect(db.deal.findFirst.mock.calls[0][0].where).toMatchObject({ id: "d1", tenantId: "t1", ownerId: "u-sales", deletedAt: null });
    expect(pay.recordPayment).not.toHaveBeenCalled();
  });

  it("refuses a deal the person cannot see", async () => {
    db.deal.findFirst.mockResolvedValue(null);
    await expect(prepare("PAYMENT_RECORD", { dealId: "x", amount: 100 })).rejects.toThrow(/No deal with that id is visible/);
  });

  it("refuses an amount above the balance, and says what the balance is", async () => {
    await expect(prepare("PAYMENT_RECORD", { dealId: "d1", amount: 800.01 })).rejects.toThrow(/more than the balance of 800.00 USD/);
    expect((await prepare("PAYMENT_RECORD", { dealId: "d1", amount: 800 })).preview.confirm?.button).toBe("Record 800.00 USD");
  });

  it("refuses another currency than the deal's, and a currency the person named matches case-insensitively", async () => {
    await expect(prepare("PAYMENT_RECORD", { dealId: "d1", amount: 100, currency: "EUR" })).rejects.toThrow(/in USD, not EUR/);
    await expect(prepare("PAYMENT_RECORD", { dealId: "d1", amount: 100, currency: "usd" })).resolves.toBeDefined();
  });

  it("refuses a date in the future, zero, and a negative amount", async () => {
    await expect(prepare("PAYMENT_RECORD", { dealId: "d1", amount: 100, paidAt: day(2) })).rejects.toThrow(/in the future/);
    await expect(prepare("PAYMENT_RECORD", { dealId: "d1", amount: 0 })).rejects.toBeInstanceOf(ToolError);
    await expect(prepare("PAYMENT_RECORD", { dealId: "d1", amount: -5 })).rejects.toBeInstanceOf(ToolError);
    expect(view.dealPaymentsView).not.toHaveBeenCalled();
  });

  it("warns about the same amount recorded in the last week, and about an open online payment link", async () => {
    db.payment.findFirst.mockResolvedValue({ paidAt: new Date(`${day(-3)}T10:00:00Z`) });
    db.paymentLink.findFirst.mockResolvedValue({ id: "pl1" });
    const out = await prepare("PAYMENT_RECORD", { dealId: "d1", amount: 400 });
    expect(out.preview.warning).toMatch(/exactly 400.00 USD was already recorded on this deal on /);
    expect(out.preview.warning).toMatch(/open online payment link/);
    expect(db.payment.findFirst.mock.calls[0][0].where).toMatchObject({ dealId: "d1", tenantId: "t1", amount: 400 });
    expect(db.paymentLink.findFirst.mock.calls[0][0].where).toEqual({ dealId: "d1", tenantId: "t1", status: "PENDING" });
  });

  it("on approval records it through the shared function, only if nothing else was paid since the card was made", async () => {
    pay.recordPayment.mockResolvedValue({});
    const done = await KINDS.PAYMENT_RECORD.apply!(sales, { dealId: "d1", amount: 400, paidAt: day(0), method: "BANK_TRANSFER", reference: "TRX-9", note: null, expect: { paid: 400 } });
    expect(pay.recordPayment).toHaveBeenCalledWith(sales, "d1", expect.objectContaining({ amount: 400, method: "BANK_TRANSFER", reference: "TRX-9", paidAt: new Date(day(0)) }), { expectPaid: 400 });
    expect(done).toEqual({ entity: "deal", id: "d1", href: "/deals/d1" });
  });

  it("checks an edited date again on approval", async () => {
    await expect(KINDS.PAYMENT_RECORD.apply!(sales, { dealId: "d1", amount: 400, paidAt: day(5), method: "CASH", expect: { paid: 0 } })).rejects.toBeInstanceOf(ApiError);
    expect(pay.recordPayment).not.toHaveBeenCalled();
  });

  it("the person can change the date, method, reference and note, but not the amount", () => {
    expect(Object.keys((KINDS.PAYMENT_RECORD.edit as unknown as { shape: object }).shape).sort()).toEqual(["method", "note", "paidAt", "reference"]);
  });
});

describe("CONTACT_CREATE", () => {
  it("shows what will be created, owned by the person, with the default type", async () => {
    const out = await prepare("CONTACT_CREATE", { firstName: " Funmi ", lastName: "Ade", phone: "+2348011111111", city: "Lagos" });
    expect(out.preview.lines).toEqual([{ label: "Name", value: "Funmi Ade" }, { label: "Phone", value: "+2348011111111" }, { label: "Type", value: "Lead" }, { label: "City", value: "Lagos" }, { label: "Owner", value: "You" }]);
    expect(out.preview.warning).toBeUndefined();
    expect(actions.createContact).not.toHaveBeenCalled();
    expect(plan.assertWithinPlan).toHaveBeenCalledWith("t1", "contacts");
    expect(dup.findDuplicates.mock.calls[0][0]).toMatchObject({ tenantId: "t1", ownerId: "u-sales" });
  });

  it("warns about a possible duplicate (same name or phone) but still lets the person decide", async () => {
    dup.findDuplicates.mockResolvedValue([{ id: "c9", firstName: "Funmi", lastName: "Ade", reasons: ["Same name", "Same phone number"] }]);
    const out = await prepare("CONTACT_CREATE", { firstName: "Funmi", lastName: "Ade" });
    expect(out.preview.warning).toBe("Possible duplicate: Funmi Ade (same name, same phone number). Check before approving.");
  });

  it("refuses when the email already belongs to a contact, and says who", async () => {
    dup.findDuplicates.mockResolvedValue([{ id: "c9", firstName: "Funmi", lastName: "Ade", reasons: ["Same email"] }]);
    await expect(prepare("CONTACT_CREATE", { firstName: "F", lastName: "A", email: "f@x.test" })).rejects.toThrow(/already exists: Funmi Ade/);
  });

  it("refuses when the plan's contact limit is reached, in the screen's own words", async () => {
    plan.assertWithinPlan.mockRejectedValue(new ApiError(403, "The Starter plan allows up to 1,000 contacts.", "PLAN_LIMIT"));
    await expect(prepare("CONTACT_CREATE", { firstName: "F", lastName: "A" })).rejects.toThrow(/allows up to 1,000 contacts/);
  });

  it("refuses a bad email, and never offers opt-in or consent fields", async () => {
    await expect(prepare("CONTACT_CREATE", { firstName: "F", lastName: "A", email: "not-an-email" })).rejects.toBeInstanceOf(ToolError);
    const input = JSON.stringify((await import("@/lib/ai/proposal-kinds")).contactCreateInput.shape ? Object.keys((await import("@/lib/ai/proposal-kinds")).contactCreateInput.shape) : []);
    expect(input).not.toMatch(/optIn|optOut|whatsapp|owner/i);
  });

  it("on approval creates it through the shared function, owned by the person, without consent flags", async () => {
    actions.createContact.mockResolvedValue({ id: "c1" });
    const done = await KINDS.CONTACT_CREATE.apply!(sales, { firstName: "Funmi", lastName: "Ade", email: null, phone: "+2348011111111", type: "LEAD", title: null, city: "Lagos", country: null, source: null });
    const body = actions.createContact.mock.calls[0][1];
    expect(body).toMatchObject({ firstName: "Funmi", lastName: "Ade", phone: "+2348011111111", type: "LEAD", city: "Lagos" });
    expect(body).not.toHaveProperty("email");
    expect(body).not.toHaveProperty("ownerId");
    expect(body).not.toHaveProperty("whatsappOptIn");
    expect(done).toEqual({ entity: "contact", id: "c1", href: "/contacts/c1" });
  });

  it("explains a unique-email clash found only at approval", async () => {
    const { Prisma } = await import("@prisma/client");
    actions.createContact.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }));
    await expect(KINDS.CONTACT_CREATE.apply!(sales, { firstName: "F", lastName: "A", email: "f@x.test", type: "LEAD" })).rejects.toMatchObject({ status: 409, code: "AI_PROPOSAL_STALE" });
  });
});

describe("DEAL_CREATE", () => {
  const items = [
    { productType: "Body wave", texture: "Straight", lengthInches: "20", color: "1B", quantity: 17, unitPrice: 60 },
    { productType: "Closure", quantity: 1, unitPrice: 180.5 },
  ];

  it("shows each item and a total the server worked out, never one the model gave", async () => {
    const out = await prepare("DEAL_CREATE", { contactId: "c1", title: "Wholesale order", currency: "usd", items, total: 1 });
    expect(line(out, "Customer")).toBe("Adaeze Okafor");
    expect(line(out, "Item 1")).toBe('17 × Body wave Straight 20" 1B at 60.00 = 1020.00');
    expect(line(out, "Item 2")).toBe("1 × Closure at 180.50 = 180.50");
    expect(line(out, "Total")).toBe("1200.50 USD");
    expect(line(out, "Stage")).toBe("Qualification");
    expect(actions.createDeal).not.toHaveBeenCalled();
  });

  it("needs a customer the person can see, a 3-letter currency, and at least one valid item", async () => {
    db.contact.findFirst.mockResolvedValue(null);
    await expect(prepare("DEAL_CREATE", { contactId: "x", title: "T", currency: "USD", items })).rejects.toBeInstanceOf(ToolError);
    db.contact.findFirst.mockResolvedValue({ firstName: "A", lastName: "B" });
    await expect(prepare("DEAL_CREATE", { contactId: "c1", title: "T", currency: "US", items })).rejects.toBeInstanceOf(ToolError);
    await expect(prepare("DEAL_CREATE", { contactId: "c1", title: "T", currency: "USD", items: [] })).rejects.toBeInstanceOf(ToolError);
    await expect(prepare("DEAL_CREATE", { contactId: "c1", title: "T", currency: "USD", items: [{ productType: "X", quantity: 0, unitPrice: 5 }] })).rejects.toBeInstanceOf(ToolError);
    await expect(prepare("DEAL_CREATE", { contactId: "c1", title: "T", currency: "USD", items: [{ productType: "X", quantity: 1 }] })).rejects.toBeInstanceOf(ToolError);
  });

  it("warns when the same customer got a deal with this title in the last 24 hours", async () => {
    db.deal.findFirst.mockResolvedValue({ id: "d0" });
    const out = await prepare("DEAL_CREATE", { contactId: "c1", title: "Wholesale order", currency: "USD", items });
    expect(out.preview.warning).toMatch(/already created for this customer in the last 24 hours/);
    expect(db.deal.findFirst.mock.calls[0][0].where).toMatchObject({ tenantId: "t1", contactId: "c1", deletedAt: null });
  });

  it("on approval creates it through the shared function with the items, and leaves the amount to the CRM", async () => {
    actions.createDeal.mockResolvedValue({ id: "d7" });
    const done = await KINDS.DEAL_CREATE.apply!(sales, { contactId: "c1", title: "Wholesale order", currency: "USD", expectedCloseDate: null, items });
    const body = actions.createDeal.mock.calls[0][1];
    expect(body).toMatchObject({ contactId: "c1", title: "Wholesale order", currency: "USD", stage: "QUALIFICATION", amount: 0 });
    expect(body.items).toHaveLength(2);
    expect(done).toEqual({ entity: "deal", id: "d7", href: "/deals/d7" });
  });

  it("lets the person change only the title and expected close date", () => {
    expect(Object.keys((KINDS.DEAL_CREATE.edit as unknown as { shape: object }).shape).sort()).toEqual(["expectedCloseDate", "title"]);
  });
});
