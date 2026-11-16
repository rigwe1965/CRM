import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, trySendMail, senderFor } = vi.hoisted(() => ({
  db: { user: { findMany: vi.fn() }, tenant: { findFirst: vi.fn() } },
  trySendMail: vi.fn(),
  senderFor: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/sender", () => ({ senderFor }));
vi.mock("@/lib/mail", () => ({ appUrl: () => "https://crm.test", trySendMail }));

import { afterCall, CREDIT_LOW_MICROS, noticesFor, sendIncludedNotices, type Position } from "@/lib/ai/included-notices";
import { includedAiEmail } from "@/lib/email-templates";

const M = 1_000_000;
const pos = (allowance: number, used: number, credit = 0): Position => ({ allowanceMicros: allowance * M, allowanceUsedMicros: used * M, creditMicros: credit * M });

describe("noticesFor", () => {
  it("says nothing while use stays below 80%", () => expect(noticesFor(pos(10, 1), pos(10, 7.9))).toEqual([]));
  it("warns the moment a call takes the allowance to 80%", () => expect(noticesFor(pos(10, 7.5), pos(10, 8.2))).toEqual(["warn"]));
  it("does not warn again once past 80%", () => expect(noticesFor(pos(10, 8.5), pos(10, 9))).toEqual([]));
  it("says used up when the last of the allowance goes and there is no credit", () => {
    expect(noticesFor(pos(10, 9.5), pos(10, 10))).toEqual(["exhausted"]);
    expect(noticesFor(pos(10, 9.5), pos(10, 10.4))).toEqual(["exhausted"]);
  });
  it("sends only 'used up' (not 80% as well) when one call jumps from below 80% to the end", () => expect(noticesFor(pos(10, 5), pos(10, 10))).toEqual(["exhausted"]));
  it("does not say used up while credit remains, and does not warn when everything is gone at once", () => {
    expect(noticesFor(pos(10, 9.5, 5), pos(10, 10, 4.5))).toEqual([]);
  });
  it("says credit is low when it drops under $1, once", () => {
    expect(noticesFor(pos(10, 10, 1.2), pos(10, 10, 0.8))).toEqual(["credit_low"]);
    expect(noticesFor(pos(10, 10, 0.8), pos(10, 10, 0.5))).toEqual([]);
  });
  it("says 'used up', not 'credit low', when the credit runs out entirely", () => expect(noticesFor(pos(10, 10, 1.2), pos(10, 10, 0))).toEqual(["exhausted"]));
  it("never warns a business with no allowance, and never says credit is low to one that never had credit", () => {
    expect(noticesFor(pos(0, 0, 0), pos(0, 0, 0))).toEqual([]);
    expect(noticesFor(pos(10, 1, 0), pos(10, 1.1, 0))).toEqual([]);
  });
  it("treats the low-credit line as $1", () => expect(CREDIT_LOW_MICROS).toBe(1_000_000));
});

describe("afterCall", () => {
  it("adds the allowance part to use and takes the credit part from credit", () => {
    expect(afterCall(pos(10, 9, 5), 3 * M, 2 * M)).toEqual(pos(10, 10, 3));
  });
  it("never lets credit go below zero", () => expect(afterCall(pos(10, 10, 1), 3 * M, 3 * M).creditMicros).toBe(0));
});

describe("includedAiEmail", () => {
  const d = { brand: "Ivy", month: "November 2026", allowanceUsd: 10, usedUsd: 8.1, creditUsd: 0, resetsOn: "2026-12-01" };
  it("warn: states the use and what happens next", () => {
    const m = includedAiEmail({ ...d, kind: "warn" });
    expect(m.subject).toBe("Your included AI is 80% used this month");
    expect(m.text).toContain("$8.10 of the $10.00");
    expect(m.text).toContain("2026-12-01");
    expect(m.html).toContain("Open settings");
  });
  it("exhausted: says AI is paused until the renewal", () => {
    const m = includedAiEmail({ ...d, kind: "exhausted" });
    expect(m.subject).toBe("Your included AI is used up");
    expect(m.text).toContain("paused until 2026-12-01");
  });
  it("credit_low: shows the credit left", () => expect(includedAiEmail({ ...d, kind: "credit_low", creditUsd: 0.75 }).subject).toBe("Your AI credit is running low ($0.75 left)"));
  it("offers both ways forward: buy credit or bring your own key", () => {
    for (const kind of ["warn", "exhausted", "credit_low"] as const) {
      const t = includedAiEmail({ ...d, kind }).text;
      expect(t).toContain("buy AI credit");
      expect(t).toContain("your own Anthropic key");
    }
  });
  it("escapes the business name in the html", () => expect(includedAiEmail({ ...d, brand: "<b>x</b>", kind: "warn" }).html).not.toContain("<b>x</b>"));
});

describe("sendIncludedNotices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.user.findMany.mockResolvedValue([{ email: "a@shop.test" }, { email: "b@shop.test" }]);
    db.tenant.findFirst.mockResolvedValue({ name: "Shop", brandName: "Ivy" });
    senderFor.mockResolvedValue("Ivy <noreply@shop.test>");
    trySendMail.mockResolvedValue(true);
  });
  const after = pos(10, 8.2);
  const now = new Date("2026-11-16T12:00:00Z");

  it("sends one email per notice to all active admins, from the business's sender", async () => {
    await sendIncludedNotices("t1", ["warn", "credit_low"], after, now);
    expect(trySendMail).toHaveBeenCalledTimes(2);
    expect(trySendMail.mock.calls[0][0]).toMatchObject({ to: ["a@shop.test", "b@shop.test"], from: "Ivy <noreply@shop.test>" });
    expect(db.user.findMany).toHaveBeenCalledWith({ where: { tenantId: "t1", role: "ADMIN", isActive: true }, select: { email: true } });
    expect(trySendMail.mock.calls[0][0].text).toContain("November 2026");
  });
  it("does nothing when there is nothing to say", async () => {
    await sendIncludedNotices("t1", [], after, now);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
  it("does nothing when the business has no active admin", async () => {
    db.user.findMany.mockResolvedValue([]);
    await sendIncludedNotices("t1", ["warn"], after, now);
    expect(trySendMail).not.toHaveBeenCalled();
  });
  it("never throws, so a failed email cannot fail the AI call", async () => {
    db.user.findMany.mockRejectedValue(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendIncludedNotices("t1", ["warn"], after, now)).resolves.toBeUndefined();
    err.mockRestore();
  });
});
