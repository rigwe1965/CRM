/** Amounts per currency code, e.g. { USD: 7309, EUR: 620 }. Currencies are never added together. */
export type MoneyMap = Record<string, number>;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function addMoney(map: MoneyMap, currency: string, amount: number) {
  map[currency] = round2((map[currency] ?? 0) + amount);
}

export function sumMoney(maps: MoneyMap[]): MoneyMap {
  const out: MoneyMap = {};
  for (const m of maps) for (const [cur, n] of Object.entries(m)) addMoney(out, cur, n);
  return out;
}
