import { describe, expect, it } from "vitest";
import { addMoney, sumMoney } from "@/lib/money";

describe("money", () => {
  it("keeps currencies separate", () => {
    expect(sumMoney([{ USD: 10, EUR: 5 }, { USD: 2.5 }, { GBP: 1 }])).toEqual({ USD: 12.5, EUR: 5, GBP: 1 });
  });
  it("rounds to cents", () => {
    const m = {};
    addMoney(m, "USD", 0.1);
    addMoney(m, "USD", 0.2);
    expect(m).toEqual({ USD: 0.3 });
  });
});
