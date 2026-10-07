import { beforeAll, describe, expect, it } from "vitest";
import { base32Decode, base32Encode, decryptSecret, encryptSecret, generateRecoveryCodes, hashRecoveryCode, otpauthUrl, totp, verifyTotp } from "@/lib/mfa";

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret-123";
});

// RFC 6238 appendix B: secret "12345678901234567890", T = 59 s -> step 1, 8-digit 94287082 (6-digit 287082).
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("totp", () => {
  it("matches the RFC 6238 test vectors", () => {
    expect(totp(RFC_SECRET, 1)).toBe("287082");
    expect(totp(RFC_SECRET, 37037036)).toBe("081804"); // T = 1111111080
  });
  it("round-trips base32", () => {
    const bytes = Buffer.from("hello world 1234");
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });
  it("accepts the current and adjacent steps, rejects others", () => {
    const now = 59_000; // step 1
    expect(verifyTotp(RFC_SECRET, "287082", null, now)).toBe(1);
    expect(verifyTotp(RFC_SECRET, "287082", null, now + 30_000)).toBe(1); // one step late
    expect(verifyTotp(RFC_SECRET, "287082", null, now + 90_000)).toBeNull();
    expect(verifyTotp(RFC_SECRET, "000000", null, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, "28708", null, now)).toBeNull();
  });
  it("refuses a time step that was already used", () => {
    expect(verifyTotp(RFC_SECRET, "287082", 1, 59_000)).toBeNull();
    expect(verifyTotp(RFC_SECRET, "287082", 0, 59_000)).toBe(1);
  });
  it("builds an otpauth URL", () => {
    expect(otpauthUrl("a@b.co", "ABC")).toContain("secret=ABC");
  });
});

describe("secret storage and recovery codes", () => {
  it("encrypts and decrypts, and detects tampering", () => {
    const enc = encryptSecret("JBSWY3DPEHPK3PXP");
    expect(enc).not.toContain("JBSWY3DP");
    expect(decryptSecret(enc)).toBe("JBSWY3DPEHPK3PXP");
    const [iv, tag, ct] = enc.split(".");
    expect(() => decryptSecret(`${iv}.${tag}.${ct.slice(0, -2)}AA`)).toThrow();
  });
  it("generates distinct codes that hash the same however they are typed", () => {
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(8);
    expect(codes[0]).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
    expect(hashRecoveryCode(codes[0])).toBe(hashRecoveryCode(codes[0].toUpperCase().replace("-", " ")));
  });
});
