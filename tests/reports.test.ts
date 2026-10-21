import { describe, expect, it } from "vitest";
import { averageDaysToPay, lastMonths, leadsBySource, revenueByMonth, topProducts } from "@/lib/reports";

const d = (s: string) => new Date(`${s}T12:00:00Z`);

describe("reports", () => {
  it("lists the last months oldest first, across a year end", () => {
    expect(lastMonths(3, d("2027-01-15"))).toEqual(["2026-11", "2026-12", "2027-01"]);
  });

  it("adds payments per month and per currency, never across currencies", () => {
    const rows = revenueByMonth(
      [
        { amount: 100, paidAt: d("2026-10-02"), currency: "USD" },
        { amount: 50.5, paidAt: d("2026-10-20"), currency: "USD" },
        { amount: 80, paidAt: d("2026-10-21"), currency: "EUR" },
        { amount: 999, paidAt: d("2025-01-01"), currency: "USD" }, // outside the period
      ],
      ["2026-09", "2026-10"],
    );
    expect(rows).toEqual([
      { month: "2026-09", revenue: {} },
      { month: "2026-10", revenue: { USD: 150.5, EUR: 80 } },
    ]);
  });

  it("measures days to the payment that completed the order, skipping unpaid and part-paid deals", () => {
    const r = averageDaysToPay([
      { amount: 100, createdAt: d("2026-10-01"), payments: [{ amount: 40, paidAt: d("2026-10-03") }, { amount: 60, paidAt: d("2026-10-11") }] }, // 10 days
      { amount: 100, createdAt: d("2026-10-01"), payments: [{ amount: 100, paidAt: d("2026-10-05") }] }, // 4 days
      { amount: 100, createdAt: d("2026-10-01"), payments: [{ amount: 30, paidAt: d("2026-10-02") }] }, // not fully paid
      { amount: 100, createdAt: d("2026-10-01"), payments: [] },
    ]);
    expect(r).toEqual({ average: 7, deals: 2 });
    expect(averageDaysToPay([])).toEqual({ average: null, deals: 0 });
  });

  it("ranks products by pieces, merging capitals, with revenue per currency", () => {
    const r = topProducts([
      { productType: "Bundle", quantity: 3, unitPrice: 100, currency: "USD" },
      { productType: "bundle", quantity: 2, unitPrice: 90, currency: "EUR" },
      { productType: "Wig", quantity: 1, unitPrice: 400, currency: "USD" },
    ]);
    expect(r[0]).toEqual({ product: "Bundle", pieces: 5, revenue: { USD: 300, EUR: 180 } });
    expect(r[1].product).toBe("Wig");
  });

  it("groups contacts by source and works out how many became customers", () => {
    const r = leadsBySource([
      { source: "Instagram", type: "CUSTOMER" },
      { source: "instagram", type: "LEAD" },
      { source: null, type: "LEAD" },
      { source: "  ", type: "LEAD" },
    ]);
    expect(r[0]).toEqual({ source: "Instagram", contacts: 2, customers: 1, conversion: 50 });
    expect(r[1]).toMatchObject({ source: "Not recorded", contacts: 2, customers: 0, conversion: 0 });
  });
});
