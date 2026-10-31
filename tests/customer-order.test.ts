import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, resolveOrderLink, reminderPayLink, stripeConfigured, rateLimit, currentOrderLink, createOrderLink } = vi.hoisted(() => ({
  db: {
    tenant: { findFirst: vi.fn() },
    deal: { findFirst: vi.fn() },
    dealItem: { findMany: vi.fn() },
    payment: { findMany: vi.fn() },
    instalment: { findMany: vi.fn() },
    customerOrderLink: { findFirst: vi.fn(), updateMany: vi.fn() },
  },
  resolveOrderLink: vi.fn(),
  reminderPayLink: vi.fn(),
  stripeConfigured: vi.fn(),
  rateLimit: vi.fn(),
  currentOrderLink: vi.fn(),
  createOrderLink: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/tenant-context", () => ({ withTenant: async (_t: string, fn: () => unknown) => fn() }));
vi.mock("@/lib/mail", () => ({ appUrl: () => "https://crm.test" }));
vi.mock("@/lib/stripe", () => ({ ONLINE_CURRENCIES: ["USD", "EUR"], stripeConfigured }));
vi.mock("@/lib/payment-links", () => ({ reminderPayLink }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit, clientIp: () => "1.2.3.4", LIMITS: { customerPay: { max: 10, windowMs: 1 } } }));
vi.mock("@/lib/order-links", () => ({ resolveOrderLink, recordOrderLinkView: vi.fn(), currentOrderLink, createOrderLink }));

import { POST } from "@/app/api/public/my-order/[token]/pay/route";
import { customerOrderView, customerPayUrl } from "@/lib/customer-order";
import { resolveSlotValues } from "@/lib/whatsapp-template-send";
import { isPublicPath } from "@/lib/rbac";

const LINK = { linkId: "L1", tenantId: "t1", dealId: "d1" };
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const future = new Date(Date.now() + 30 * 86_400_000);

function order({ amount = 1000, paid = 0, currency = "USD", schedule = [] as { id: string; position: number; dueDate: Date; amount: number }[] } = {}) {
  db.tenant.findFirst.mockResolvedValue({ name: "Ivycandy Hair LLC", brandName: "Ivycandy Hair" });
  db.deal.findFirst.mockResolvedValue({ id: "d1", title: "Wig order", amount, currency, createdAt: day("2026-10-01"), contact: { firstName: "Ada" } });
  db.dealItem.findMany.mockResolvedValue([{ productType: "Wig", texture: "Straight", lengthInches: "22", color: "1B", laceType: null, quantity: 2, unitPrice: 500 }]);
  db.payment.findMany.mockResolvedValue(paid ? [{ id: "p1", amount: paid, paidAt: day("2026-10-05"), createdAt: day("2026-10-05"), recordedBy: { id: "u9", name: "Staff Person" } }] : []);
  db.instalment.findMany.mockResolvedValue(schedule);
  db.customerOrderLink.findFirst.mockResolvedValue({ createdBy: { id: "u1", email: "a@x.test" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  stripeConfigured.mockResolvedValue(true);
  rateLimit.mockResolvedValue({ allowed: true, retryAfter: 0 });
});

describe("what the customer sees", () => {
  it("shows the order, totals and a pay amount, and counts the visit", async () => {
    order({ paid: 400 });
    const v = (await customerOrderView("t1", "d1", "L1"))!;
    expect(v).toMatchObject({ brand: "Ivycandy Hair", firstName: "Ada", total: 1000, paid: 400, balance: 600, payAmount: 600, canPayOnline: true });
    expect(v.items).toEqual([{ description: 'Wig · Straight · 22" · 1B', quantity: 2, unitPrice: 500 }]);
  });

  it("leaks no staff names or internal ids", async () => {
    order({ paid: 400 });
    const json = JSON.stringify(await customerOrderView("t1", "d1"));
    expect(json).not.toContain("Staff Person");
    expect(json).not.toContain("u9");
    expect(json).not.toContain("ownerId");
  });

  it("asks for the next instalment's unpaid part, not the whole balance", async () => {
    order({ paid: 100, schedule: [{ id: "i1", position: 1, dueDate: day("2026-11-01"), amount: 300 }, { id: "i2", position: 2, dueDate: day("2026-12-01"), amount: 700 }] });
    const v = (await customerOrderView("t1", "d1"))!;
    expect(v.payAmount).toBe(200);
    expect(v.instalments.map((i) => i.state)).toEqual(["PART_PAID", "UPCOMING"]);
  });

  it("offers no Pay now on a settled order, a currency Stripe isn't used for, or without Stripe", async () => {
    order({ paid: 1000 });
    expect(await customerOrderView("t1", "d1")).toMatchObject({ balance: 0, payAmount: 0, canPayOnline: false });
    order({ currency: "NGN" });
    expect((await customerOrderView("t1", "d1"))!.canPayOnline).toBe(false);
    order();
    stripeConfigured.mockResolvedValue(false);
    expect((await customerOrderView("t1", "d1"))!.canPayOnline).toBe(false);
  });

  it("returns null when the order is gone", async () => {
    order();
    db.deal.findFirst.mockResolvedValue(null);
    expect(await customerOrderView("t1", "d1")).toBeNull();
  });
});

describe("Pay now", () => {
  it("asks for exactly the amount due, filed under the link's creator", async () => {
    order({ paid: 400 });
    reminderPayLink.mockResolvedValue("https://buy.stripe.test/x");
    expect(await customerPayUrl(LINK)).toBe("https://buy.stripe.test/x");
    expect(reminderPayLink).toHaveBeenCalledWith({ id: "u1", tenantId: "t1", email: "a@x.test" }, { id: "d1", title: "Wig order" }, 600, "USD", "https://crm.test");
  });

  it("returns null and creates nothing when nothing is owed", async () => {
    order({ paid: 1000 });
    expect(await customerPayUrl(LINK)).toBeNull();
    expect(reminderPayLink).not.toHaveBeenCalled();
  });

  const call = (token = "t".repeat(43)) => POST(new Request("https://crm.test/x", { method: "POST" }), { params: Promise.resolve({ token }) });

  it("redirects a valid link to Stripe with a 303", async () => {
    order();
    resolveOrderLink.mockResolvedValue(LINK);
    reminderPayLink.mockResolvedValue("https://buy.stripe.test/x");
    const res = await call();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://buy.stripe.test/x");
  });

  it("sends the customer back to the page, on the configured site, when Stripe can't be used", async () => {
    order();
    resolveOrderLink.mockResolvedValue(LINK);
    reminderPayLink.mockResolvedValue(null);
    const res = await call("abc");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://crm.test/my-order/abc?pay=unavailable");
  });

  it("gives every dead link the same plain 404", async () => {
    resolveOrderLink.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
    expect(reminderPayLink).not.toHaveBeenCalled();
  });

  it("is rate limited per visitor before anything is looked up", async () => {
    rateLimit.mockResolvedValue({ allowed: false, retryAfter: 30 });
    const res = await call();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(resolveOrderLink).not.toHaveBeenCalled();
  });
});

describe("public paths", () => {
  it("opens the order page and its pay route without a sign-in, and nothing else new", () => {
    expect(isPublicPath("/my-order/abc")).toBe(true);
    expect(isPublicPath("/api/public/my-order/abc/pay")).toBe(true);
    expect(isPublicPath("/api/deals/d1/customer-link")).toBe(false);
  });
});

describe("the orderLink template blank", () => {
  const user = { id: "u1", tenantId: "t1", role: "ADMIN" } as Parameters<typeof resolveSlotValues>[0];
  const contact = { id: "c1", firstName: "Ada", lastName: "Okafor" };
  const slots = [{ label: "Link", source: "orderLink" as const }];

  beforeEach(() => db.deal.findFirst.mockResolvedValue({ id: "d1", title: "Wig order", amount: 10, currency: "USD" }));

  it("uses the live customer link without making another", async () => {
    currentOrderLink.mockResolvedValue({ status: "ACTIVE", url: "https://crm.test/my-order/live" });
    expect(await resolveSlotValues(user, contact, slots, { dealId: "d1" })).toEqual(["https://crm.test/my-order/live"]);
    expect(createOrderLink).not.toHaveBeenCalled();
  });

  it("makes a link when the order has none live", async () => {
    currentOrderLink.mockResolvedValue({ status: "REVOKED", url: null });
    createOrderLink.mockResolvedValue({ url: "https://crm.test/my-order/new" });
    expect(await resolveSlotValues(user, contact, slots, { dealId: "d1" })).toEqual(["https://crm.test/my-order/new"]);
  });

  it("asks for the order first, like the other order blanks", async () => {
    await expect(resolveSlotValues(user, contact, slots, {})).rejects.toMatchObject({ status: 422 });
  });
});
