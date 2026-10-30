import { describe, expect, it } from "vitest";
import { addMoney, round2, sumMoney } from "@/lib/money";
import { money, moneyMap } from "@/lib/client/format";

describe("negative zero", () => {
  it("round2 never returns -0, and leaves real values alone", () => {
    expect(round2(-1e-17)).toBe(0);
    expect(round2(0.3 - (0.1 + 0.2))).toBe(0);
    expect(round2(-0.004)).toBe(0);
    expect(round2(-50)).toBe(-50);
    expect(round2(-0.015)).toBe(-0.01);
    expect(round2(12.345)).toBe(12.35);
  });

  it("addMoney lands on a plain zero when amounts cancel out", () => {
    const m: Record<string, number> = {};
    addMoney(m, "USD", 0.3);
    addMoney(m, "USD", -(0.1 + 0.2));
    expect(m.USD).toBe(0);
  });

  it("money() shows anything that rounds to zero without a minus sign", () => {
    expect(money(-0)).toBe("$0");
    expect(money(-0.3)).toBe("$0");
    expect(money(-0.04, "USD", true)).toBe("$0");
    expect(moneyMap({ USD: -0 })).toBe("$0");
  });

  it("money() still shows real negatives and positives", () => {
    expect(money(-50)).toBe("-$50");
    expect(money(-0.6)).toBe("-$1");
    expect(money(1234)).toBe("$1,234");
    expect(money(0.4)).toBe("$0");
  });
});

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
