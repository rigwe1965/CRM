import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decryptSecret, decryptSecretInfo, encryptSecret } from "@/lib/mfa";

const env = process.env as Record<string, string | undefined>;
const names = ["NEXTAUTH_SECRET", "MFA_ENCRYPTION_KEY", "MFA_ENCRYPTION_KEY_PREVIOUS"];
let saved: Record<string, string | undefined>;
const newKey = () => randomBytes(32).toString("base64");

beforeEach(() => {
  saved = Object.fromEntries(names.map((n) => [n, env[n]]));
  env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret-0123456789";
  delete env.MFA_ENCRYPTION_KEY;
  delete env.MFA_ENCRYPTION_KEY_PREVIOUS;
});
afterEach(() => {
  for (const n of names) {
    if (saved[n] === undefined) delete env[n];
    else env[n] = saved[n];
  }
});

describe("MFA secret encryption keys", () => {
  it("keeps the legacy format when no dedicated key is set", () => {
    const enc = encryptSecret("JBSWY3DPEHPK3PXP");
    expect(enc.startsWith("v2.")).toBe(false);
    expect(decryptSecretInfo(enc)).toEqual({ plain: "JBSWY3DPEHPK3PXP", current: true });
  });

  it("uses the dedicated key for new secrets", () => {
    env.MFA_ENCRYPTION_KEY = newKey();
    const enc = encryptSecret("JBSWY3DPEHPK3PXP");
    expect(enc.startsWith("v2.")).toBe(true);
    expect(decryptSecretInfo(enc)).toEqual({ plain: "JBSWY3DPEHPK3PXP", current: true });
  });

  it("still reads legacy secrets after a dedicated key is added, and flags them for re-encryption", () => {
    const legacy = encryptSecret("JBSWY3DPEHPK3PXP");
    env.MFA_ENCRYPTION_KEY = newKey();
    expect(decryptSecretInfo(legacy)).toEqual({ plain: "JBSWY3DPEHPK3PXP", current: false });
  });

  it("rotates: reads with the previous key, flags it, and a new secret uses the new key", () => {
    const oldKey = newKey();
    env.MFA_ENCRYPTION_KEY = oldKey;
    const enc = encryptSecret("JBSWY3DPEHPK3PXP");
    env.MFA_ENCRYPTION_KEY = newKey();
    env.MFA_ENCRYPTION_KEY_PREVIOUS = oldKey;
    expect(decryptSecretInfo(enc)).toEqual({ plain: "JBSWY3DPEHPK3PXP", current: false });
    expect(decryptSecretInfo(encryptSecret("ABC"))).toEqual({ plain: "ABC", current: true });
  });

  it("fails once the old key is gone", () => {
    env.MFA_ENCRYPTION_KEY = newKey();
    const enc = encryptSecret("JBSWY3DPEHPK3PXP");
    env.MFA_ENCRYPTION_KEY = newKey();
    expect(() => decryptSecret(enc)).toThrow();
  });

  it("rejects a key that is too short", () => {
    env.MFA_ENCRYPTION_KEY = Buffer.from("short").toString("base64");
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
  });
});
