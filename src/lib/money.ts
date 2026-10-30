/** Amounts per currency code, e.g. { USD: 7309, EUR: 620 }. Currencies are never added together. */
export type MoneyMap = Record<string, number>;

/** Rounds to cents. The `+ 0` turns -0 (what a tiny negative like -1e-17 rounds to) into 0, so it never prints as "-0.00". */
export const round2 = (n: number) => Math.round(n * 100) / 100 + 0;

export function addMoney(map: MoneyMap, currency: string, amount: number) {
  map[currency] = round2((map[currency] ?? 0) + amount);
}

export function sumMoney(maps: MoneyMap[]): MoneyMap {
  const out: MoneyMap = {};
  for (const m of maps) for (const [cur, n] of Object.entries(m)) addMoney(out, cur, n);
  return out;
}
