import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, autoUpdate } = vi.hoisted(() => ({
  db: { deal: { findFirst: vi.fn(), update: vi.fn() }, activity: { create: vi.fn() } },
  autoUpdate: vi.fn(),
}));
vi.mock("@/lib/automations/shipping-updates", () => ({ runShippingUpdate: autoUpdate }));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/route", () => ({
  authed: (handler: (ctx: unknown) => Promise<Response>) => async (req: Request, context?: { params: Promise<unknown> }) => {
    try {
      return await handler({ req, user: { id: "u1", tenantId: "t1", role: "SALES", name: "Sam", email: "s@x.test" }, params: (await context?.params) ?? {} });
    } catch (e) {
      const err = e as { status?: number; code?: string; fieldErrors?: unknown };
      return new Response(JSON.stringify({ code: err.code, details: err.fieldErrors }), { status: err.status ?? 500 });
    }
  },
}));

import { POST } from "@/app/api/deals/[id]/fulfilment/route";
import { canFulfil, statusColumns, trackingUrl } from "@/lib/fulfilment";
import { dealFulfilmentSchema, dealListQuery } from "@/lib/validations/crm";

const T1 = new Date("2026-11-01T10:00:00Z");
const T2 = new Date("2026-11-03T10:00:00Z");
const NOW = new Date("2026-11-05T10:00:00Z");

describe("status columns", () => {
  const start = { fulfilmentStatus: "NOT_STARTED" as const, shippedAt: null, deliveredAt: null };

  it("stamps the shipped date once and the delivered date when delivered", () => {
    const shipped = statusColumns(start, "SHIPPED", T1);
    expect(shipped).toEqual({ fulfilmentStatus: "SHIPPED", shippedAt: T1, deliveredAt: null });
    expect(statusColumns({ ...shipped }, "DELIVERED", T2)).toEqual({ fulfilmentStatus: "DELIVERED", shippedAt: T1, deliveredAt: T2 });
  });

  it("delivering straight from packed also fills the shipped date", () => {
    expect(statusColumns({ ...start, fulfilmentStatus: "PACKED" }, "DELIVERED", T2)).toEqual({ fulfilmentStatus: "DELIVERED", shippedAt: T2, deliveredAt: T2 });
  });

  it("keeps an earlier date when the same step is set again", () => {
    expect(statusColumns({ fulfilmentStatus: "DELIVERED", shippedAt: T1, deliveredAt: T2 }, "DELIVERED", NOW)).toMatchObject({ shippedAt: T1, deliveredAt: T2 });
  });

  it("going back clears the dates of steps that no longer apply", () => {
    const delivered = { fulfilmentStatus: "DELIVERED" as const, shippedAt: T1, deliveredAt: T2 };
    expect(statusColumns(delivered, "SHIPPED", NOW)).toEqual({ fulfilmentStatus: "SHIPPED", shippedAt: T1, deliveredAt: null });
    expect(statusColumns(delivered, "PACKED", NOW)).toEqual({ fulfilmentStatus: "PACKED", shippedAt: null, deliveredAt: null });
  });

  it("a return keeps the dates, since it came after them", () => {
    expect(statusColumns({ fulfilmentStatus: "DELIVERED", shippedAt: T1, deliveredAt: T2 }, "RETURNED", NOW)).toEqual({ fulfilmentStatus: "RETURNED", shippedAt: T1, deliveredAt: T2 });
  });

  it("only a won deal can be fulfilled", () => {
    expect(canFulfil("CLOSED_WON")).toBe(true);
    for (const s of ["QUALIFICATION", "PROPOSAL", "NEGOTIATION", "CLOSED_LOST"]) expect(canFulfil(s)).toBe(false);
  });
});

describe("tracking links", () => {
  it("builds the carrier's page for known carriers, in any spelling", () => {
    expect(trackingUrl("DHL", "123456")).toBe("https://www.dhl.com/global-en/home/tracking.html?tracking-id=123456");
    expect(trackingUrl("fedex", "1Z 9")).toContain("trknbr=1Z%209");
    expect(trackingUrl(" Fed-Ex ", "9")).toContain("fedex.com");
    expect(trackingUrl("UPS", "1Z999")).toBe("https://www.ups.com/track?tracknum=1Z999");
    expect(trackingUrl("USPS", "9400")).toContain("tLabels=9400");
  });

  it("gives no link for an unknown carrier or a missing number, and escapes the number", () => {
    expect(trackingUrl("Local courier", "123")).toBeNull();
    expect(trackingUrl("DHL", "  ")).toBeNull();
    expect(trackingUrl(null, "123")).toBeNull();
    expect(trackingUrl("DHL", "x&evil=1")).toContain("x%26evil%3D1");
  });
});

describe("validation", () => {
  it("needs at least one field, and keeps tracking numbers free of spaces", () => {
    expect(dealFulfilmentSchema.safeParse({}).success).toBe(false);
    expect(dealFulfilmentSchema.safeParse({ status: "SHIPPED" }).success).toBe(true);
    expect(dealFulfilmentSchema.safeParse({ trackingNumber: "12 34" }).success).toBe(false);
    expect(dealFulfilmentSchema.safeParse({ status: "LOST" }).success).toBe(false);
    expect(dealFulfilmentSchema.parse({ carrier: "  DHL ", trackingNumber: "" })).toEqual({ carrier: "DHL", trackingNumber: null });
  });

  it("the list filters accept toShip and a status list", () => {
    expect(dealListQuery.parse({ toShip: "true", fulfilment: "PACKED,SHIPPED" })).toMatchObject({ toShip: true, fulfilment: ["PACKED", "SHIPPED"] });
    expect(dealListQuery.safeParse({ fulfilment: "NOPE" }).success).toBe(false);
  });
});

describe("POST /api/deals/:id/fulfilment", () => {
  const call = (body: unknown, id = "d1") =>
    POST(new Request("https://x.test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
  const deal = (over: object = {}) => ({ stage: "CLOSED_WON", fulfilmentStatus: "NOT_STARTED", shippedAt: null, deliveredAt: null, carrier: null, trackingNumber: null, contactId: "c1", ...over });

  beforeEach(() => {
    vi.clearAllMocks();
    autoUpdate.mockResolvedValue("OFF");
    db.deal.findFirst.mockResolvedValue(deal());
    db.deal.update.mockImplementation(async ({ data }) => ({ id: "d1", amount: 10, fulfilmentStatus: "NOT_STARTED", ...data, items: [] }));
  });

  it("ships a won order, scoped to the caller's business, and notes it on the timeline", async () => {
    const res = await call({ status: "SHIPPED", carrier: "DHL", trackingNumber: "123" });
    expect(res.status).toBe(200);
    expect(db.deal.findFirst.mock.calls[0][0].where).toMatchObject({ id: "d1", deletedAt: null });
    expect(JSON.stringify(db.deal.findFirst.mock.calls[0][0].where)).toContain("t1");
    expect(db.deal.update.mock.calls[0][0].data).toMatchObject({ fulfilmentStatus: "SHIPPED", carrier: "DHL", trackingNumber: "123", deliveredAt: null });
    expect(db.deal.update.mock.calls[0][0].data.shippedAt).toBeInstanceOf(Date);
    expect(db.activity.create.mock.calls[0][0].data).toMatchObject({ tenantId: "t1", type: "NOTE", subject: "Order shipped", body: "DHL · tracking 123", authorId: "u1", contactId: "c1", dealId: "d1" });
  });

  it("runs the automatic update after a status change, and reports whether it went out", async () => {
    autoUpdate.mockResolvedValue("SENT");
    const body = (await (await call({ status: "SHIPPED" })).json()) as { data: { shippingUpdate: string } };
    expect(body.data.shippingUpdate).toBe("SENT");
    expect(autoUpdate.mock.calls[0][1]).toEqual({ id: "d1", contactId: "c1" });
    expect(autoUpdate.mock.calls[0][2]).toBe("SHIPPED");
  });

  it("does not run it when only the tracking changed", async () => {
    await call({ trackingNumber: "9" });
    expect(autoUpdate).not.toHaveBeenCalled();
  });

  it("refuses a deal that isn't won", async () => {
    db.deal.findFirst.mockResolvedValue(deal({ stage: "NEGOTIATION" }));
    const res = await call({ status: "PACKED" });
    expect(res.status).toBe(422);
    expect(db.deal.update).not.toHaveBeenCalled();
  });

  it("404s a deal the caller can't see", async () => {
    db.deal.findFirst.mockResolvedValue(null);
    expect((await call({ status: "PACKED" })).status).toBe(404);
    expect(db.activity.create).not.toHaveBeenCalled();
  });

  it("changing only the tracking leaves the status and dates alone and notes the update", async () => {
    db.deal.findFirst.mockResolvedValue(deal({ fulfilmentStatus: "SHIPPED", shippedAt: T1, carrier: "DHL", trackingNumber: "1" }));
    await call({ trackingNumber: "2" });
    const data = db.deal.update.mock.calls[0][0].data;
    expect(data).toEqual({ carrier: "DHL", trackingNumber: "2" });
    expect(db.activity.create.mock.calls[0][0].data).toMatchObject({ subject: "Tracking updated", body: "DHL · tracking 2" });
  });

  it("writes no timeline note when nothing changed", async () => {
    db.deal.findFirst.mockResolvedValue(deal({ fulfilmentStatus: "PACKED" }));
    await call({ status: "PACKED" });
    expect(db.activity.create).not.toHaveBeenCalled();
  });

  it("rejects an empty or bad body with 422", async () => {
    expect((await call({})).status).toBe(422);
    expect((await call({ trackingNumber: "a b" })).status).toBe(422);
  });
});
