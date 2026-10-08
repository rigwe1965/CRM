import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
import { requireMfaStepUp } from "@/lib/mfa-server";
import { changePasswordSchema } from "@/lib/validations/auth";

const base = { id: "u1", mfaSecret: null, mfaLastStep: null, mfaRecoveryCodes: [] as string[] };

describe("requireMfaStepUp", () => {
  it("does nothing when two-step verification is off", async () => {
    await expect(requireMfaStepUp({ ...base, mfaEnabledAt: null }, undefined)).resolves.toBeUndefined();
  });
  it("demands a code when it is on", async () => {
    await expect(requireMfaStepUp({ ...base, mfaEnabledAt: new Date() }, undefined)).rejects.toMatchObject({ status: 422 });
    await expect(requireMfaStepUp({ ...base, mfaEnabledAt: new Date() }, "  ")).rejects.toMatchObject({ status: 422 });
  });
  it("rejects a wrong code", async () => {
    await expect(requireMfaStepUp({ ...base, mfaEnabledAt: new Date() }, "123456")).rejects.toMatchObject({ status: 400 });
  });
});

describe("changePasswordSchema", () => {
  it("accepts an optional code", () => {
    expect(changePasswordSchema.safeParse({ newPassword: "Correct-horse-9", code: "123456" }).success).toBe(true);
    expect(changePasswordSchema.safeParse({ newPassword: "Correct-horse-9" }).success).toBe(true);
  });
});
