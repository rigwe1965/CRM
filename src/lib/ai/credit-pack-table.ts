/**
 * The AI credit packs a business can buy (INCLUDED_AI_PLAN.md, option D). Kept free of Stripe and database imports so the
 * status screen can list them cheaply. This table is the only source of how much credit a payment is worth. Prices are
 * the owner's (2026-11-16, "Balanced": a 2x markup); change them here. Packs are in US dollars.
 */
export const CREDIT_PACKS = [
  { id: "pack10", priceCents: 1000, creditMicros: 5_000_000 },
  { id: "pack25", priceCents: 2500, creditMicros: 12_500_000 },
] as const;
export type PackId = (typeof CREDIT_PACKS)[number]["id"];
export const PACK_IDS = CREDIT_PACKS.map((p) => p.id) as [PackId, ...PackId[]];
export const CREDIT_CURRENCY = "usd";
export const packById = (id: unknown) => CREDIT_PACKS.find((p) => p.id === id);
