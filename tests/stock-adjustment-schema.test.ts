import { describe, expect, it } from "vitest";
import { createStockAdjustmentSchema, updateStockAdjustmentSchema } from "@/lib/validations/crm";

const ok = { product: "Bone straight", color: "1B", lengthInches: 16, quantity: -2, reason: "Damaged" };

describe("stock adjustment schemas", () => {
  it("accepts a valid adjustment and defaults colour to empty", () => {
    expect(createStockAdjustmentSchema.safeParse(ok).success).toBe(true);
    const { color: _c, ...noColor } = ok;
    expect(createStockAdjustmentSchema.parse(noColor).color).toBe("");
  });
  it("rejects zero, fractional and huge quantities", () => {
    for (const quantity of [0, 1.5, 100_001, -100_001]) {
      expect(createStockAdjustmentSchema.safeParse({ ...ok, quantity }).success).toBe(false);
    }
  });
  it("requires a product and a reason", () => {
    expect(createStockAdjustmentSchema.safeParse({ ...ok, product: " " }).success).toBe(false);
    expect(createStockAdjustmentSchema.safeParse({ ...ok, reason: "" }).success).toBe(false);
  });
  it("update only changes quantity, reason or note, and needs at least one", () => {
    expect(updateStockAdjustmentSchema.safeParse({}).success).toBe(false);
    expect(updateStockAdjustmentSchema.safeParse({ quantity: 3 }).success).toBe(true);
    expect(updateStockAdjustmentSchema.parse({ quantity: 3, product: "x" })).toEqual({ quantity: 3 });
  });
});
