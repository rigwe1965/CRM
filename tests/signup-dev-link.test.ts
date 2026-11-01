import { afterEach, describe, expect, it, vi } from "vitest";
import { devLinksEnabled } from "@/lib/signup";
import { assertProductionEnv } from "@/lib/env";

// The signup confirmation link may only come back in the response in local development: it needs the explicit
// SIGNUP_DEV_LINKS=1 flag AND console-only mail (no provider, not production).

afterEach(() => vi.unstubAllEnvs());

const dev = () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("EMAIL_SERVER", "");
};

describe("signup dev link", () => {
  it("is off without the flag, even in development with no mail provider", () => {
    dev();
    vi.stubEnv("SIGNUP_DEV_LINKS", "");
    expect(devLinksEnabled()).toBe(false);
  });

  it("is on with the flag and console-only mail", () => {
    dev();
    vi.stubEnv("SIGNUP_DEV_LINKS", "1");
    expect(devLinksEnabled()).toBe(true);
  });

  it("is off when a real mail provider is configured, even with the flag", () => {
    dev();
    vi.stubEnv("RESEND_API_KEY", "re_123");
    vi.stubEnv("SIGNUP_DEV_LINKS", "1");
    expect(devLinksEnabled()).toBe(false);
  });

  it("is off in production, even with the flag", () => {
    dev();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SIGNUP_DEV_LINKS", "1");
    expect(devLinksEnabled()).toBe(false);
  });

  it("makes production start-up fail when the flag is set", () => {
    const good = {
      NODE_ENV: "production", DATABASE_URL: "postgresql://x", NEXTAUTH_SECRET: "x".repeat(40), NEXTAUTH_URL: "https://crm.test", AUTH_TRUST_HOST: "true",
      RESEND_API_KEY: "re_1", EMAIL_FROM: "CRM <a@b.test>", CRON_SECRET: "c".repeat(20), UPSTASH_REDIS_REST_URL: "https://u.test", UPSTASH_REDIS_REST_TOKEN: "t",
    MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), PLATFORM_DATABASE_URL: "postgresql://owner",
    };
    for (const [k, v] of Object.entries(good)) vi.stubEnv(k, v);
    vi.stubEnv("SIGNUP_DEV_LINKS", "1");
    expect(() => assertProductionEnv()).toThrow(/SIGNUP_DEV_LINKS/);
  });
});
