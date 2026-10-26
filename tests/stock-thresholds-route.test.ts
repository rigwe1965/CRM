import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, loadStock, loadLowStock, role } = vi.hoisted(() => ({
  db: { stockThreshold: { upsert: vi.fn(), findMany: vi.fn() } },
  loadStock: vi.fn(),
  loadLowStock: vi.fn(),
  role: { current: "ADMIN" as "ADMIN" | "SALES" },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/automations/settings", () => ({ loadLowStock }));
vi.mock("@/lib/stock", async (orig) => ({ ...(await orig<typeof import("@/lib/stock")>()), loadStock }));
// Skip auth and rate limiting, but keep the role check: only admins may set levels.
vi.mock("@/lib/route", () => ({
  authed:
    (handler: (ctx: unknown) => Promise<Response>, ...roles: string[]) =>
    async (req: Request, context?: { params: Promise<unknown> }) => {
      if (roles.length && !roles.includes(role.current)) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
      return handler({ req, user: { id: "u1", role: role.current, tenantId: "t1" }, params: context ? await context.params : {} });
    },
}));

import { GET } from "@/app/api/stock/route";
import { PUT } from "@/app/api/stock/thresholds/route";

const none = { params: Promise.resolve({}) };
const put = (body: unknown) =>
  PUT(new Request("http://x.test/api/stock/thresholds", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), none);

beforeEach(() => {
  vi.clearAllMocks();
  role.current = "ADMIN";
  db.stockThreshold.upsert.mockImplementation(async ({ create }) => ({ key: create.key, threshold: create.threshold }));
  db.stockThreshold.findMany.mockResolvedValue([]);
  loadLowStock.mockResolvedValue({ enabled: true, defaultThreshold: 3 });
});

describe("PUT /api/stock/thresholds", () => {
  it("saves a level for the row, named like the stock table names it, in the caller's business only", async () => {
    const res = await put({ product: "Bone Straight Bundle", color: "1B Color", lengthInches: 16, threshold: 5 });
    expect(res.status).toBe(200);
    const q = db.stockThreshold.upsert.mock.calls[0][0];
    expect(q.where).toEqual({ tenantId_key: { tenantId: "t1", key: "bone straight bundle|1b|16" } });
    expect(q.create).toMatchObject({ tenantId: "t1", key: "bone straight bundle|1b|16", product: "Bone Straight Bundle", lengthInches: 16, threshold: 5 });
    expect(await res.json()).toEqual({ data: { key: "bone straight bundle|1b|16", threshold: 5 } });
  });

  it("accepts null (use the default) and 0 (never), and a row with no colour or length", async () => {
    await put({ product: "Pixie curl", threshold: null });
    expect(db.stockThreshold.upsert.mock.calls[0][0].create).toMatchObject({ key: "pixie curl||", color: "", lengthInches: null, threshold: null });
    await put({ product: "Pixie curl", threshold: 0 });
    expect(db.stockThreshold.upsert.mock.calls[1][0].create.threshold).toBe(0);
  });

  it("refuses non-admins", async () => {
    role.current = "SALES";
    expect((await put({ product: "Pixie curl", threshold: 5 })).status).toBe(403);
    expect(db.stockThreshold.upsert).not.toHaveBeenCalled();
  });

  it("refuses bad levels", async () => {
    for (const body of [{ product: "X", threshold: -1 }, { product: "X", threshold: 1.5 }, { product: "X" }, { product: "", threshold: 2 }, { product: "X", threshold: 100_001 }]) {
      await expect(put(body)).rejects.toMatchObject({ status: 422 });
    }
    expect(db.stockThreshold.upsert).not.toHaveBeenCalled();
  });
});

describe("GET /api/stock", () => {
  it("marks low rows using each row's own level or the default, and reports the setting", async () => {
    const r = (product: string, onHand: number) => ({ key: `${product.toLowerCase()}||`, product, description: "", color: "", lengthInches: null, bought: onHand, sold: 0, adjusted: 0, onHand, adjustments: [], sources: [] });
    loadStock.mockResolvedValue({ rows: [r("A", 2), r("B", 2), r("C", 9)], unmatched: [] });
    db.stockThreshold.findMany.mockResolvedValue([{ key: "b||", threshold: 0 }, { key: "c||", threshold: 10 }]);
    const { data } = await (await GET(new Request("http://x.test/api/stock"), none)).json();
    expect(db.stockThreshold.findMany.mock.calls[0][0].where).toEqual({ tenantId: "t1" });
    expect(data.rows.map((x: { product: string; low: boolean; level: number }) => [x.product, x.low, x.level])).toEqual([["A", true, 3], ["B", false, 0], ["C", true, 10]]);
    expect(data).toMatchObject({ defaultThreshold: 3, alertsOn: true, unmatched: [] });
  });

  it("reads stock with the caller's own scope, so a salesperson still sees only their own stock", async () => {
    role.current = "SALES";
    loadStock.mockResolvedValue({ rows: [], unmatched: [] });
    await GET(new Request("http://x.test/api/stock"), none);
    expect(loadStock).toHaveBeenCalledWith({ tenantId: "t1", ownerId: "u1" });
  });
});
