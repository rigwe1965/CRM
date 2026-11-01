import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp } from "@/lib/rate-limit";

const h = (xff?: string, realIp?: string) => {
  const headers = new Headers();
  if (xff) headers.set("x-forwarded-for", xff);
  if (realIp) headers.set("x-real-ip", realIp);
  return headers;
};

afterEach(() => vi.unstubAllEnvs());

describe("clientIp", () => {
  it("ignores a forged leftmost entry behind one trusted proxy", () => {
    vi.stubEnv("VERCEL", "");
    // The attacker sent "1.1.1.1"; our proxy appended the address it actually saw.
    expect(clientIp(h("1.1.1.1, 203.0.113.7"))).toBe("203.0.113.7");
  });

  it("counts TRUSTED_PROXY_COUNT proxies from the right", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("TRUSTED_PROXY_COUNT", "2");
    expect(clientIp(h("9.9.9.9, 203.0.113.7, 10.0.0.2"))).toBe("203.0.113.7");
  });

  it("uses the rightmost entry, never the leftmost, when the chain is shorter than the proxy count", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("TRUSTED_PROXY_COUNT", "3");
    expect(clientIp(h("6.6.6.6, 203.0.113.7"))).toBe("203.0.113.7");
  });

  it("uses the platform value on Vercel", () => {
    vi.stubEnv("VERCEL", "1");
    expect(clientIp(h("203.0.113.7"))).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, then unknown", () => {
    expect(clientIp(h(undefined, "198.51.100.4"))).toBe("198.51.100.4");
    expect(clientIp(h())).toBe("unknown");
  });
});

describe("production proxy settings", () => {
  const base = {
    NODE_ENV: "production", DATABASE_URL: "postgresql://x", NEXTAUTH_SECRET: "x".repeat(40), NEXTAUTH_URL: "https://crm.test", AUTH_TRUST_HOST: "true",
    RESEND_API_KEY: "re_1", EMAIL_FROM: "CRM <a@b.test>", CRON_SECRET: "c".repeat(20), UPSTASH_REDIS_REST_URL: "https://u.test", UPSTASH_REDIS_REST_TOKEN: "t",
    MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), PLATFORM_DATABASE_URL: "postgresql://owner",
  };
  const apply = (extra: Record<string, string> = {}) => {
    for (const [k, v] of Object.entries({ ...base, ...extra })) vi.stubEnv(k, v);
    vi.stubEnv("VERCEL", "");
  };

  it("warns, but still starts, when TRUSTED_PROXY_COUNT is unset on a self-hosted deployment", async () => {
    const { assertProductionEnv, productionWarnings } = await import("@/lib/env");
    apply();
    vi.stubEnv("TRUSTED_PROXY_COUNT", "");
    vi.stubEnv("SUPPORT_EMAIL", "help@shop.test"); // set, so the only warning left is the proxy one
    expect(productionWarnings(process.env)).toHaveLength(1);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => assertProductionEnv()).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not warn when it is set, or on Vercel", async () => {
    const { productionWarnings } = await import("@/lib/env");
    const ok = { SUPPORT_EMAIL: "help@shop.test" };
    expect(productionWarnings({ ...ok, TRUSTED_PROXY_COUNT: "2" })).toEqual([]);
    expect(productionWarnings({ ...ok, VERCEL: "1" })).toEqual([]);
  });

  it("refuses a value that is not a positive whole number", async () => {
    const { assertProductionEnv } = await import("@/lib/env");
    for (const bad of ["0", "two", "-1", "1.5"]) {
      apply({ TRUSTED_PROXY_COUNT: bad });
      expect(() => assertProductionEnv()).toThrow(/TRUSTED_PROXY_COUNT/);
    }
  });
});
