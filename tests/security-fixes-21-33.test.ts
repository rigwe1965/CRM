import { describe, expect, it, vi } from "vitest";

const { db, rateLimit } = vi.hoisted(() => ({
  db: { tenant: { findFirst: vi.fn() } },
  rateLimit: vi.fn(async (..._a: unknown[]) => ({ allowed: true, retryAfter: 0 })),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit }));

import { assertCanSendFreeText, assertUnderDailyCap } from "@/lib/usage-limits";

describe("free-text email on a trial (finding 4)", () => {
  it("refuses a trial business with no verified sender domain", async () => {
    db.tenant.findFirst.mockResolvedValue({ plan: "trial", senderVerifiedAt: null });
    await expect(assertCanSendFreeText("t1")).rejects.toMatchObject({ status: 403, code: "TRIAL_EMAIL_RESTRICTED" });
  });
  it("allows a trial business with a verified domain, and any paid plan", async () => {
    db.tenant.findFirst.mockResolvedValue({ plan: "trial", senderVerifiedAt: new Date() });
    await expect(assertCanSendFreeText("t1")).resolves.toBeUndefined();
    db.tenant.findFirst.mockResolvedValue({ plan: "starter", senderVerifiedAt: null });
    await expect(assertCanSendFreeText("t1")).resolves.toBeUndefined();
  });
});

describe("platform-wide email ceiling (finding 4)", () => {
  it("refuses mail for every business once the platform ceiling is used", async () => {
    db.tenant.findFirst.mockResolvedValue({ plan: "starter" });
    rateLimit.mockImplementation(async (key: unknown) => ({ allowed: key !== "usage:emails:platform", retryAfter: 0 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(assertUnderDailyCap("t1", "emails")).rejects.toMatchObject({ code: "USAGE_LIMIT" });
    warn.mockRestore();
  });
  it("does not apply it to the internal plan", async () => {
    db.tenant.findFirst.mockResolvedValue({ plan: "internal" });
    rateLimit.mockClear();
    await expect(assertUnderDailyCap("t1", "emails")).resolves.toBeUndefined();
    expect(rateLimit).not.toHaveBeenCalled();
  });
});
