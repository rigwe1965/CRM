import { describe, expect, it } from "vitest";
import { passwordSchema } from "@/lib/validations/auth";

const ok = (v: string) => passwordSchema.safeParse(v).success;

describe("passwordSchema", () => {
  it("accepts a normal strong password", () => expect(ok("Blue-Kettle-4821")).toBe(true));
  it("requires 10+ characters, a letter and a number", () => {
    expect(ok("Short1a")).toBe(false);
    expect(ok("onlylettersandmore")).toBe(false);
    expect(ok("1234567890123")).toBe(false);
  });
  it("rejects commonly guessed passwords, whatever the case", () => {
    expect(ok("Password123")).toBe(false);
    expect(ok("ChangeMe123!")).toBe(false);
    expect(ok("QWERTY12345")).toBe(false);
  });
  it("rejects repeats and sequences", () => {
    expect(ok("aaaaaaaaaaaa")).toBe(false);
    expect(ok("1234567890ab")).toBe(false);
  });
  it("caps the length at bcrypt's 72 bytes", () => expect(ok("a1" + "x".repeat(71))).toBe(false));
});
