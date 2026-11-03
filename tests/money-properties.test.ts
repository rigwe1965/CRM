import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { addMoney, round2, sumMoney, type MoneyMap } from "@/lib/money";
import { summarize } from "@/lib/payments";

// Property tests for the money rules: whatever amounts and orders turn up, the floating-point code must agree with
// exact integer-cent arithmetic. Seeded, so a failure reproduces; the case that failed is in the message.

/** Small deterministic generator (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const cents = (n: number) => n / 100;
const DAY = 86_400_000;
const RUNS = 400;

describe("summarize agrees with integer-cent arithmetic", () => {
  it("covers exactly min(paid, scheduled) oldest-first, never negative, never over an instalment", () => {
    const r = rng(20261103);
    for (let run = 0; run < RUNS; run++) {
      const n = int(r, 0, 8);
      const amounts = Array.from({ length: n }, () => int(r, 1, 2_500_000)); // up to 25,000.00 each
      const payments = Array.from({ length: int(r, 0, 12) }, () => int(r, 1, 1_000_000));
      const total = int(r, 0, 20_000_000);
      const base = Date.UTC(2026, 0, 1);
      const schedule = amounts.map((c, i) => ({ id: `i${i}`, position: i, dueDate: new Date(base + i * 30 * DAY), amount: cents(c) }));
      // Shuffle: the result must not depend on input order.
      const shuffled = [...schedule].sort(() => r() - 0.5);

      // The caller sums payments as floats (see dealPaymentsView); that sum is what summarize receives.
      const paidFloat = payments.reduce((s, c) => s + cents(c), 0);
      const paidCents = payments.reduce((s, c) => s + c, 0);
      const ctx = JSON.stringify({ run, amounts, payments, total });

      const { summary, instalments } = summarize(cents(total), paidFloat, shuffled, "2026-06-01");

      // Order: oldest first.
      expect(instalments.map((i) => i.id), ctx).toEqual(schedule.map((i) => i.id));

      // Exact expectation in integer cents.
      let left = paidCents;
      for (const [i, inst] of instalments.entries()) {
        const want = Math.min(left, amounts[i]);
        left -= want;
        expect(Math.round(inst.covered * 100), `${ctx} instalment ${i}`).toBe(want);
        expect(inst.covered).toBeGreaterThanOrEqual(0);
        expect(inst.covered).toBeLessThanOrEqual(inst.amount);
      }
      expect(Math.round(summary.paid * 100), ctx).toBe(paidCents);
      expect(Math.round(summary.balance * 100), ctx).toBe(total - paidCents);

      const firstOpen = amounts.findIndex((c, i) => Math.round(instalments[i].covered * 100) < c);
      if (firstOpen === -1) expect(summary.nextDue, ctx).toBeNull();
      else {
        const owed = amounts[firstOpen] - Math.round(instalments[firstOpen].covered * 100);
        expect(Math.round(summary.nextDue!.amount * 100), ctx).toBe(owed);
      }
    }
  });

  it("an instalment paid in many small payments is covered, despite float drift (0.1 + 0.2 style sums)", () => {
    for (const parts of [[0.1, 0.2], [0.7, 0.1, 0.1, 0.1], Array(10).fill(0.1), Array(30).fill(0.01), [19.99, 0.01, 0.1, 0.2]]) {
      const paid = parts.reduce((s, p) => s + p, 0);
      const target = round2(paid);
      const { instalments, summary } = summarize(target, paid, [{ id: "a", position: 0, dueDate: new Date("2026-01-01"), amount: target }], "2027-01-01");
      expect(instalments[0].covered, String(parts)).toBe(target);
      expect(instalments[0].overdue, String(parts)).toBe(false);
      expect(summary.balance, String(parts)).toBe(0);
      expect(summary.nextDue, String(parts)).toBeNull();
    }
  });
});

describe("sumMoney / addMoney agree with integer-cent arithmetic", () => {
  it("per-currency totals are exact and independent of order and grouping", () => {
    const r = rng(7);
    const codes = ["USD", "EUR", "GBP", "NGN"];
    for (let run = 0; run < RUNS; run++) {
      const entries = Array.from({ length: int(r, 0, 40) }, () => ({ cur: codes[int(r, 0, 3)], c: int(r, -500_000, 5_000_000) }));
      const exact: Record<string, number> = {};
      for (const e of entries) exact[e.cur] = (exact[e.cur] ?? 0) + e.c;

      const flat: MoneyMap = {};
      for (const e of entries) addMoney(flat, e.cur, cents(e.c));

      // Same entries, shuffled and split into separate maps, then merged.
      const shuffled = [...entries].sort(() => r() - 0.5);
      const half = Math.floor(shuffled.length / 2);
      const toMap = (es: typeof entries) => {
        const m: MoneyMap = {};
        for (const e of es) addMoney(m, e.cur, cents(e.c));
        return m;
      };
      const merged = sumMoney([toMap(shuffled.slice(0, half)), toMap(shuffled.slice(half))]);

      const ctx = JSON.stringify({ run, entries });
      for (const code of Object.keys(exact)) {
        expect(Math.round(flat[code] * 100), `${ctx} ${code} flat`).toBe(exact[code]);
        expect(Math.round(merged[code] * 100), `${ctx} ${code} merged`).toBe(exact[code]);
        expect(Object.is(flat[code], -0), `${ctx} ${code} -0`).toBe(false);
      }
      // A currency is never created out of thin air or merged into another.
      expect(Object.keys(flat).sort()).toEqual(Object.keys(exact).sort());
    }
  });
});

describe("Decimal to number at the DTO boundary", () => {
  it("every Decimal(12,2) value up to 9,999,999,999.99 survives Number() exactly and is already on the cent grid", () => {
    const r = rng(99);
    const edge = ["0.00", "0.01", "0.10", "0.29", "1.005", "9999999999.99", "1234567890.12", "-0.01", "-9999999999.99"];
    const values = [...edge.filter((v) => v.split(".")[1].length <= 2), ...Array.from({ length: 2000 }, () => (int(r, 0, 999_999_999_999) / 100).toFixed(2))];
    for (const text of values) {
      const dec = new Prisma.Decimal(text);
      const n = Number(dec);
      expect(dec.toFixed(2), text).toBe(Number(text).toFixed(2));
      expect(round2(n), `${text} should already be on the cent grid`).toBe(n);
      expect(Math.round(n * 100), text).toBe(Number(dec.times(100).toFixed(0)));
    }
  });

  it("Prisma sums of Decimal columns, once converted, agree with exact cents", () => {
    const r = rng(5);
    for (let run = 0; run < 200; run++) {
      const cs = Array.from({ length: int(r, 1, 25) }, () => int(r, 1, 999_999));
      const exact = cs.reduce((a, b) => a + b, 0);
      const dec = cs.map((c) => new Prisma.Decimal((c / 100).toFixed(2))).reduce((a, b) => a.plus(b), new Prisma.Decimal(0));
      expect(Math.round(Number(dec) * 100), JSON.stringify(cs)).toBe(exact);
      // The float path the routes use (Number() of each, then +) matches once rounded to cents.
      const viaFloat = cs.reduce((s, c) => s + Number((c / 100).toFixed(2)), 0);
      expect(Math.round(round2(viaFloat) * 100), JSON.stringify(cs)).toBe(exact);
    }
  });
});
