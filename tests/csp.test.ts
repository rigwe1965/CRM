import { afterEach, describe, expect, it } from "vitest";
import { buildCsp, cspHeaderName, makeNonce } from "@/lib/csp";

const env = process.env as Record<string, string | undefined>;
const saved = env.CSP_REPORT_ONLY;
afterEach(() => {
  if (saved === undefined) delete env.CSP_REPORT_ONLY;
  else env.CSP_REPORT_ONLY = saved;
});

describe("content security policy", () => {
  it("makes a different nonce every time", () => {
    const set = new Set(Array.from({ length: 50 }, makeNonce));
    expect(set.size).toBe(50);
  });
  it("allows scripts only with the nonce and never unsafe-inline", () => {
    const csp = buildCsp("abc123", false);
    const script = csp.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(script).toContain("'nonce-abc123'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });
  it("adds unsafe-eval in development only", () => {
    expect(buildCsp("n", true)).toContain("'unsafe-eval'");
    expect(buildCsp("n", false)).not.toContain("'unsafe-eval'");
  });
  it("can run in report-only mode", () => {
    delete env.CSP_REPORT_ONLY;
    expect(cspHeaderName()).toBe("Content-Security-Policy");
    env.CSP_REPORT_ONLY = "1";
    expect(cspHeaderName()).toBe("Content-Security-Policy-Report-Only");
  });
});
