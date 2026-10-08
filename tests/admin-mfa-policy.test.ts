import { afterEach, describe, expect, it } from "vitest";
import { adminMfaRequired, mfaPending } from "@/lib/rbac";

const env = process.env as Record<string, string | undefined>;
const saved = { v: env.REQUIRE_ADMIN_MFA, n: env.NODE_ENV };
const restore = (k: string, v: string | undefined) => (v === undefined ? delete env[k] : (env[k] = v));
afterEach(() => {
  restore("REQUIRE_ADMIN_MFA", saved.v);
  restore("NODE_ENV", saved.n);
});

describe("mfaPending", () => {
  it("only holds back admins without two-step verification", () => {
    expect(mfaPending("ADMIN", false, true)).toBe(true);
    expect(mfaPending("ADMIN", true, true)).toBe(false);
    expect(mfaPending("SALES", false, true)).toBe(false);
    expect(mfaPending("SUPPORT", false, true)).toBe(false);
    expect(mfaPending(undefined, false, true)).toBe(false);
  });
  it("does nothing when the policy is off", () => expect(mfaPending("ADMIN", false, false)).toBe(false));
});

describe("adminMfaRequired", () => {
  it("defaults to on in production and off elsewhere", () => {
    delete env.REQUIRE_ADMIN_MFA;
    env.NODE_ENV = "production";
    expect(adminMfaRequired()).toBe(true);
    env.NODE_ENV = "development";
    expect(adminMfaRequired()).toBe(false);
  });
  it("can be overridden either way", () => {
    env.NODE_ENV = "production";
    env.REQUIRE_ADMIN_MFA = "0";
    expect(adminMfaRequired()).toBe(false);
    env.NODE_ENV = "development";
    env.REQUIRE_ADMIN_MFA = "1";
    expect(adminMfaRequired()).toBe(true);
  });
});
