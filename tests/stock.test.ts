import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
import { computeStock, type BoughtLine, type SoldLine } from "@/lib/stock";

const bought = (o: Partial<BoughtLine> = {}): BoughtLine => ({
  style: "Bone Straight", description: "Bone Straight Bundle", color: "1B", lengthInches: 16, quantity: 10, ...o,
});
const sold = (o: Partial<SoldLine> = {}): SoldLine => ({
  dealId: "d1", dealTitle: "Deal", productType: "bone straight", color: "1b Color", lengthInches: '16"', quantity: 3, ...o,
});

describe("computeStock", () => {
  it("matches case-insensitively and ignores the word colour", () => {
    const { rows, unmatched } = computeStock([bought()], [sold()]);
    expect(unmatched).toEqual([]);
    expect(rows[0]).toMatchObject({ bought: 10, sold: 3, onHand: 7 });
  });

  it("matches on the invoice description as well as the style", () => {
    const { rows } = computeStock([bought()], [sold({ productType: "Bone Straight Bundle" })]);
    expect(rows[0].sold).toBe(3);
  });

  it("accepts 16, 16\", 16 inch as the same length", () => {
    for (const len of ["16", '16"', "16 inch", "16in"]) {
      expect(computeStock([bought()], [sold({ lengthInches: len })]).rows[0].sold).toBe(3);
    }
  });

  it("reports sales that match nothing, with a reason", () => {
    const { unmatched, rows } = computeStock([bought()], [sold({ lengthInches: "20" }), sold({ lengthInches: "12, 16" })]);
    expect(unmatched).toHaveLength(2);
    expect(unmatched[0].reason).toMatch(/No invoice line/);
    expect(unmatched[1].reason).toMatch(/single number/);
    expect(rows[0].sold).toBe(0);
  });

  it("sums several purchases of the same line", () => {
    const { rows } = computeStock([bought(), bought({ quantity: 5 })], [sold()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ bought: 15, onHand: 12 });
  });

  it("can go negative when more is sold than bought", () => {
    expect(computeStock([bought({ quantity: 1 })], [sold()]).rows[0].onHand).toBe(-2);
  });
});
