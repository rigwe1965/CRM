import { afterEach, describe, expect, it, vi } from "vitest";
import { assertProductionEnv } from "@/lib/env";

const good = {
  NODE_ENV: "production", DATABASE_URL: "postgresql://x", NEXTAUTH_SECRET: "x".repeat(40), NEXTAUTH_URL: "https://crm.test", AUTH_TRUST_HOST: "true", TRUSTED_PROXY_COUNT: "1",
  RESEND_API_KEY: "re_1", EMAIL_FROM: "CRM <a@b.test>", CRON_SECRET: "c".repeat(20), UPSTASH_REDIS_REST_URL: "https://u.test", UPSTASH_REDIS_REST_TOKEN: "t",
  MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), PLATFORM_DATABASE_URL: "postgresql://owner",
};
const apply = (over: Record<string, string> = {}) => {
  for (const [k, v] of Object.entries({ ...good, ALLOW_UNRESTRICTED_DB_ROLE: "", VERCEL: "", ...over })) vi.stubEnv(k, v);
};
afterEach(() => vi.unstubAllEnvs());

describe("production keys (finding 3 and 2)", () => {
  it("accepts a complete setup", () => {
    apply();
    expect(() => assertProductionEnv()).not.toThrow();
  });
  it("refuses to start without MFA_ENCRYPTION_KEY", () => {
    apply({ MFA_ENCRYPTION_KEY: "" });
    expect(() => assertProductionEnv()).toThrow(/MFA_ENCRYPTION_KEY/);
  });
  it("refuses to start without PLATFORM_DATABASE_URL unless the owner accepts it", () => {
    apply({ PLATFORM_DATABASE_URL: "" });
    expect(() => assertProductionEnv()).toThrow(/PLATFORM_DATABASE_URL/);
    apply({ PLATFORM_DATABASE_URL: "", ALLOW_UNRESTRICTED_DB_ROLE: "1" });
    expect(() => assertProductionEnv()).not.toThrow();
  });
});
