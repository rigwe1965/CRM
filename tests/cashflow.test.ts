import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
import { profitByCurrency } from "@/lib/cashflow";

describe("profitByCurrency", () => {
  it("keeps each currency separate", () => {
    const out = profitByCurrency([
      { currency: "USD", revenue: "1000", cost: "600" },
      { currency: "EUR", revenue: 200, cost: 250 },
    ]);
    expect(out.USD).toEqual({ estimated: 400, revenue: 1000, cost: 600, margin: 40 });
    expect(out.EUR).toEqual({ estimated: -50, revenue: 200, cost: 250, margin: -25 });
  });

  it("rounds to cents and margin to one decimal", () => {
    const out = profitByCurrency([{ currency: "USD", revenue: "100.005", cost: "33.333" }]);
    expect(out.USD.revenue).toBe(100.01);
    expect(out.USD.cost).toBe(33.33);
    expect(out.USD.margin).toBe(66.7);
  });

  it("has a null margin when there is no revenue", () => {
    expect(profitByCurrency([{ currency: "USD", revenue: null, cost: null }]).USD.margin).toBeNull();
  });

  it("is empty when no line has a resale price", () => {
    expect(profitByCurrency([])).toEqual({});
  });
});
