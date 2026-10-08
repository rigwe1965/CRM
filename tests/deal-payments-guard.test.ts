import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
import { ApiError } from "@/lib/api";
import { assertDealCoversPayments } from "@/lib/deals";

const fails = (fn: () => void, field: string) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).status).toBe(422);
    expect((e as ApiError).fieldErrors).toHaveProperty(field);
    return;
  }
  throw new Error("expected an ApiError");
};

describe("assertDealCoversPayments", () => {
  it("rejects a total below what is paid", () => {
    fails(() => assertDealCoversPayments({ paid: 5000, currency: "USD", newTotal: 1 }), "amount");
  });
  it("allows a total equal to or above what is paid", () => {
    expect(() => assertDealCoversPayments({ paid: 5000, currency: "USD", newTotal: 5000 })).not.toThrow();
    expect(() => assertDealCoversPayments({ paid: 5000, currency: "USD", newTotal: 6000 })).not.toThrow();
  });
  it("rejects a currency change once paid, allows it before", () => {
    fails(() => assertDealCoversPayments({ paid: 10, currency: "USD", newCurrency: "EUR" }), "currency");
    expect(() => assertDealCoversPayments({ paid: 0, currency: "USD", newCurrency: "EUR" })).not.toThrow();
    expect(() => assertDealCoversPayments({ paid: 10, currency: "USD", newCurrency: "USD" })).not.toThrow();
  });
  it("ignores fields that are not being changed", () => {
    expect(() => assertDealCoversPayments({ paid: 999, currency: "USD" })).not.toThrow();
  });
});
