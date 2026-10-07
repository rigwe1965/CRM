import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
import { invoiceTotals } from "@/lib/invoices";

describe("invoiceTotals", () => {
  it("computes line totals, subtotal and defaults the deal price to subtotal + shipping", () => {
    const r = invoiceTotals([{ quantity: 2, unitPrice: 44.5 }, { quantity: 1, unitPrice: 51 }], 10);
    expect(r).toEqual({ lineTotals: [89, 51], subtotal: 140, total: 150 });
  });
  it("honours an explicit lineTotal and negotiated total", () => {
    const r = invoiceTotals([{ quantity: 3, unitPrice: 10, lineTotal: 25 }], 0, 20);
    expect(r).toMatchObject({ subtotal: 25, total: 20 });
  });
});
