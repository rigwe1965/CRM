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

  it("uses the platform value on Vercel", () => {
    vi.stubEnv("VERCEL", "1");
    expect(clientIp(h("203.0.113.7"))).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, then unknown", () => {
    expect(clientIp(h(undefined, "198.51.100.4"))).toBe("198.51.100.4");
    expect(clientIp(h())).toBe("unknown");
  });
});
