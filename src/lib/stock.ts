import type { DealStage } from "@prisma/client";
import { db } from "@/lib/db";

/** Stages where the customer has agreed to buy, so the pieces are spoken for. */
const SOLD_STAGES: DealStage[] = ["PROPOSAL", "NEGOTIATION", "CLOSED_WON"];

export type BoughtLine = { style: string; description: string; color: string | null; lengthInches: number | null; quantity: number };
export type SoldLine = { dealId: string; dealTitle: string; productType: string; color: string | null; lengthInches: string | null; quantity: number };

export type StockRow = { product: string; description: string; color: string; lengthInches: number | null; bought: number; sold: number; onHand: number };
export type UnmatchedSale = { dealId: string; dealTitle: string; product: string; color: string; length: string; quantity: number; reason: string };

/** Case-insensitive text key: "1B Color" and "1b" both become "1b". */
const norm = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/\bcolou?r\b/g, "")
    .replace(/[^a-z0-9#/ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** "16", "16\"" and "16 inch" are 16. Blank is "". Anything else ("12, 16") can't be matched: null. */
function lengthKey(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined || String(v).trim() === "") return "";
  const m = String(v).trim().match(/^(\d{1,3})\s*("|in|inch|inches)?$/i);
  return m ? m[1] : null;
}

/**
 * Stock on hand = pieces bought (supplier invoice lines) minus pieces sold (deal items), matched
 * on product, colour and length. A sold line matches an invoice line when its product equals the
 * invoice line's style or description. Sales that match nothing come back as `unmatched`.
 */
export function computeStock(bought: BoughtLine[], sold: SoldLine[]) {
  const rows = new Map<string, StockRow>();
  const alias = new Map<string, string>(); // "product|color|length" -> row key

  for (const b of bought) {
    const color = norm(b.color);
    const len = b.lengthInches === null ? "" : String(b.lengthInches);
    const key = `${norm(b.style)}|${color}|${len}`;
    const row = rows.get(key) ?? { product: b.style, description: b.description, color: b.color ?? "", lengthInches: b.lengthInches, bought: 0, sold: 0, onHand: 0 };
    row.bought += b.quantity;
    rows.set(key, row);
    for (const name of [norm(b.style), norm(b.description)]) {
      const a = `${name}|${color}|${len}`;
      if (!alias.has(a)) alias.set(a, key);
    }
  }

  const unmatched: UnmatchedSale[] = [];
  for (const s of sold) {
    const len = lengthKey(s.lengthInches);
    const base = { dealId: s.dealId, dealTitle: s.dealTitle, product: s.productType, color: s.color ?? "", length: s.lengthInches ?? "", quantity: s.quantity };
    if (len === null) {
      unmatched.push({ ...base, reason: "Length isn't a single number (e.g. use 16, not 12, 16)" });
      continue;
    }
    const key = alias.get(`${norm(s.productType)}|${norm(s.color)}|${len}`);
    if (!key) {
      unmatched.push({ ...base, reason: "No invoice line with the same product, colour and length" });
      continue;
    }
    rows.get(key)!.sold += s.quantity;
  }

  const list = [...rows.values()]
    .map((r) => ({ ...r, onHand: r.bought - r.sold }))
    .sort((a, b) => a.product.localeCompare(b.product) || a.color.localeCompare(b.color) || (a.lengthInches ?? 0) - (b.lengthInches ?? 0));
  return { rows: list, unmatched };
}

/** Loads the caller's invoice lines and deal items (`owned` is the usual ownerScope) and computes stock. */
export async function loadStock(owned: { ownerId?: string }) {
  const [invoiceItems, dealItems] = await Promise.all([
    db.invoiceItem.findMany({
      where: { invoice: { ...owned, status: { not: "CANCELLED" } } },
      select: { style: true, description: true, color: true, lengthInches: true, quantity: true },
    }),
    db.dealItem.findMany({
      where: { deal: { ...owned, deletedAt: null, stage: { in: SOLD_STAGES } } },
      select: { productType: true, color: true, lengthInches: true, quantity: true, deal: { select: { id: true, title: true } } },
    }),
  ]);
  return computeStock(
    invoiceItems,
    dealItems.map((d) => ({
      dealId: d.deal.id,
      dealTitle: d.deal.title,
      productType: d.productType,
      color: d.color,
      lengthInches: d.lengthInches,
      quantity: d.quantity,
    })),
  );
}
