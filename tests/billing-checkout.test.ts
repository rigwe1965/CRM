import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/platform-db", () => ({ platformDb: {} }));
vi.mock("@/lib/mail", () => ({ appUrl: () => "https://crm.test" }));

import { automaticTax, checkoutSessionParams } from "@/lib/billing";

const base = { customer: "cus_1", tenantId: "t1", price: "price_1", baseUrl: "https://crm.test" };

afterEach(() => vi.unstubAllEnvs());

describe("checkoutSessionParams", () => {
  it("asks for no tax handling until BILLING_AUTOMATIC_TAX is on, so Checkout works before Stripe Tax is set up", () => {
    vi.stubEnv("BILLING_AUTOMATIC_TAX", "");
    const p = checkoutSessionParams(base);
    expect(automaticTax()).toBe(false);
    expect(p.automatic_tax).toBeUndefined();
    expect(p.tax_id_collection).toBeUndefined();
    expect(p.customer_update).toBeUndefined();
    expect(p.line_items).toEqual([{ price: "price_1", quantity: 1 }]);
  });

  it("turns on Stripe Tax, the billing address, tax numbers and saving them to the customer", () => {
    vi.stubEnv("BILLING_AUTOMATIC_TAX", "1");
    const p = checkoutSessionParams(base);
    expect(p.automatic_tax).toEqual({ enabled: true });
    expect(p.billing_address_collection).toBe("required");
    expect(p.tax_id_collection).toEqual({ enabled: true });
    expect(p.customer_update).toEqual({ address: "auto", name: "auto" });
  });

  it("sends a chosen currency in lower case, and none when the buyer didn't choose", () => {
    expect(checkoutSessionParams({ ...base, currency: "GBP" }).currency).toBe("gbp");
    expect(checkoutSessionParams(base)).not.toHaveProperty("currency");
  });

  it("keeps the business id and a running trial on the subscription", () => {
    const p = checkoutSessionParams({ ...base, trialEnd: 1_800_000_000 });
    expect(p.client_reference_id).toBe("t1");
    expect(p.subscription_data).toEqual({ metadata: { tenantId: "t1" }, trial_end: 1_800_000_000 });
    expect(checkoutSessionParams(base).subscription_data).toEqual({ metadata: { tenantId: "t1" } });
  });
});
