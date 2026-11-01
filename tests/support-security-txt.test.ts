import { afterEach, describe, expect, it, vi } from "vitest";
import { securityContact, securityTxt, supportInfo, validEmail, validHttpsUrl } from "@/lib/support";
import { isPublicPath } from "@/lib/rbac";
import { productionWarnings } from "@/lib/env";

afterEach(() => vi.unstubAllEnvs());

describe("support settings", () => {
  it("shows an address or status page only when it is set and well formed", () => {
    expect(supportInfo({})).toEqual({ email: null, statusUrl: null });
    expect(supportInfo({ SUPPORT_EMAIL: " help@shop.test ", STATUS_PAGE_URL: "https://status.shop.test" })).toEqual({ email: "help@shop.test", statusUrl: "https://status.shop.test" });
    expect(supportInfo({ SUPPORT_EMAIL: "not an email", STATUS_PAGE_URL: "javascript:alert(1)" })).toEqual({ email: null, statusUrl: null });
    expect(supportInfo({ STATUS_PAGE_URL: "http://status.shop.test" }).statusUrl).toBeNull();
  });
  it("validates emails and https addresses", () => {
    expect(validEmail("a@b.co")).toBe(true);
    expect(validEmail("a@b")).toBe(false);
    expect(validEmail("a b@c.com")).toBe(false);
    expect(validHttpsUrl("https://x.test/p")).toBe(true);
    expect(validHttpsUrl("ftp://x.test")).toBe(false);
  });
  it("warns at start-up when there is no support address", () => {
    expect(productionWarnings({ VERCEL: "1" }).join(" ")).toMatch(/SUPPORT_EMAIL/);
    expect(productionWarnings({ VERCEL: "1", SUPPORT_EMAIL: "help@shop.test" }).join(" ")).not.toMatch(/SUPPORT_EMAIL/);
    expect(productionWarnings({ VERCEL: "1" }).join(" ")).toMatch(/LEGAL_REVIEWED/);
    expect(productionWarnings({ VERCEL: "1", LEGAL_REVIEWED: "1" }).join(" ")).not.toMatch(/LEGAL_REVIEWED/);
  });
});

describe("security.txt", () => {
  const now = new Date("2026-11-01T00:00:00Z");
  it("does not exist until there is a contact", () => {
    expect(securityTxt("https://crm.test", {}, now)).toBeNull();
  });
  it("uses the security address, else the support address", () => {
    expect(securityContact({ SUPPORT_EMAIL: "help@shop.test" })).toBe("help@shop.test");
    expect(securityContact({ SUPPORT_EMAIL: "help@shop.test", SECURITY_EMAIL: "sec@shop.test" })).toBe("sec@shop.test");
  });
  it("has the fields RFC 9116 asks for, with an expiry a year ahead", () => {
    const txt = securityTxt("https://crm.test", { SECURITY_EMAIL: "sec@shop.test" }, now)!;
    expect(txt).toContain("Contact: mailto:sec@shop.test");
    expect(txt).toContain("Expires: 2027-11-01T00:00:00.000Z");
    expect(txt).toContain("Canonical: https://crm.test/.well-known/security.txt");
  });
  it("can be read without signing in", () => {
    expect(isPublicPath("/.well-known/security.txt")).toBe(true);
    expect(isPublicPath("/.well-known/other")).toBe(true);
    expect(isPublicPath("/dashboard")).toBe(false);
  });
});
