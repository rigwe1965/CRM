import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { tenantIntegration: { findFirst: vi.fn(async () => null) } } }));

import { getIntegration, whatsappSettings } from "@/lib/integrations";
import { DEFAULT_TENANT_ID } from "@/lib/tenant";

const base = { accessToken: "tok-1234567890", phoneNumberId: "123456", appSecret: "secret-12345", verifyToken: "verify-token-123456" };

describe("WhatsApp settings: Business Account ID", () => {
  it("is optional, so settings saved before it existed stay valid", () => {
    expect(whatsappSettings.safeParse(base).success).toBe(true);
  });

  it("accepts digits and trims spaces", () => {
    expect(whatsappSettings.parse({ ...base, businessAccountId: " 109876543210 " }).businessAccountId).toBe("109876543210");
  });

  it("refuses something that is not a numeric ID", () => {
    expect(whatsappSettings.safeParse({ ...base, businessAccountId: "my business" }).success).toBe(false);
    expect(whatsappSettings.safeParse({ ...base, businessAccountId: "12" }).success).toBe(false);
  });
});

describe("original business falls back to the environment", () => {
  afterEach(() => {
    for (const k of ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_BUSINESS_ACCOUNT_ID"]) delete process.env[k];
  });
  const setEnv = () => Object.assign(process.env, { WHATSAPP_ACCESS_TOKEN: base.accessToken, WHATSAPP_PHONE_NUMBER_ID: base.phoneNumberId, WHATSAPP_APP_SECRET: base.appSecret, WHATSAPP_VERIFY_TOKEN: base.verifyToken });

  it("reads WHATSAPP_BUSINESS_ACCOUNT_ID when set, and works without it", async () => {
    setEnv();
    expect((await getIntegration(DEFAULT_TENANT_ID, "WHATSAPP"))?.settings.businessAccountId).toBeUndefined();
    process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = "109876543210";
    expect((await getIntegration(DEFAULT_TENANT_ID, "WHATSAPP"))?.settings.businessAccountId).toBe("109876543210");
  });

  it("never gives another business the original's environment settings", async () => {
    setEnv();
    process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = "109876543210";
    expect(await getIntegration("tenant_other", "WHATSAPP")).toBeNull();
  });
});
