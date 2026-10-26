import type { DealStage } from "@prisma/client";
import { db } from "@/lib/db";
import type { OwnerScope } from "@/lib/access";

/** Stages where the customer has agreed to buy, so the pieces are spoken for. */
const SOLD_STAGES: DealStage[] = ["PROPOSAL", "NEGOTIATION", "CLOSED_WON"];

export type BoughtLine = {
  style: string;
  description: string;
  color: string | null;
  lengthInches: number | null;
  quantity: number;
  invoice?: { id: string; number: string };
};
export type SoldLine = { dealId: string; dealTitle: string; productType: string; color: string | null; lengthInches: string | null; quantity: number };
export type AdjustmentLine = {
  id: string;
  product: string;
  color: string;
  lengthInches: number | null;
  quantity: number;
  reason: string;
  note: string | null;
  createdAt: Date;
};

export type StockRow = {
  /** Names the row: normalised product, colour and length (see stockKey). Low-stock levels are saved against it. */
  key: string;
  product: string;
  description: string;
  color: string;
  lengthInches: number | null;
  bought: number;
  sold: number;
  /** Sum of manual adjustments (signed). */
  adjusted: number;
  onHand: number;
  adjustments: Pick<AdjustmentLine, "id" | "quantity" | "reason" | "note" | "createdAt">[];
  /** Distinct invoices the bought pieces came from, so the line can be fixed there. */
  sources: { invoiceId: string; number: string }[];
};
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
 * The name of a stock row: product, colour and length, case-insensitive. The stock table, the saved low-stock
 * levels and the daily alert all use this one function, so they always agree on which row is which.
 */
export const stockKey = (product: string, color: string | null | undefined, lengthInches: number | null | undefined) =>
  `${norm(product)}|${norm(color)}|${lengthInches ?? ""}`;

const newRow = (key: string, product: string, description: string, color: string, lengthInches: number | null): StockRow => ({
  key,
  product,
  description,
  color,
  lengthInches,
  bought: 0,
  sold: 0,
  adjusted: 0,
  onHand: 0,
  adjustments: [],
  sources: [],
});

/**
 * Stock on hand = pieces bought (supplier invoice lines) minus pieces sold (deal items) plus manual
 * adjustments, matched on product, colour and length. A sold line matches an invoice line when its
 * product equals the invoice line's style or description. Sales that match nothing come back as
 * `unmatched`. An adjustment with no matching invoice line gets its own row (opening stock).
 */
export function computeStock(bought: BoughtLine[], sold: SoldLine[], adjustments: AdjustmentLine[] = []) {
  const rows = new Map<string, StockRow>();
  const alias = new Map<string, string>(); // "product|color|length" -> row key

  for (const b of bought) {
    const color = norm(b.color);
    const len = b.lengthInches === null ? "" : String(b.lengthInches);
    const key = stockKey(b.style, b.color, b.lengthInches);
    const row = rows.get(key) ?? newRow(key, b.style, b.description, b.color ?? "", b.lengthInches);
    row.bought += b.quantity;
    if (b.invoice && !row.sources.some((x) => x.invoiceId === b.invoice!.id)) {
      row.sources.push({ invoiceId: b.invoice.id, number: b.invoice.number });
    }
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

  for (const a of adjustments) {
    const own = stockKey(a.product, a.color, a.lengthInches);
    const key = alias.get(own) ?? own;
    const row = rows.get(key) ?? newRow(key, a.product, "Manual stock", a.color, a.lengthInches);
    row.adjusted += a.quantity;
    row.adjustments.push({ id: a.id, quantity: a.quantity, reason: a.reason, note: a.note, createdAt: a.createdAt });
    rows.set(key, row);
  }

  const list = [...rows.values()]
    .map((r) => ({ ...r, onHand: r.bought - r.sold + r.adjusted }))
    .sort((a, b) => a.product.localeCompare(b.product) || a.color.localeCompare(b.color) || (a.lengthInches ?? 0) - (b.lengthInches ?? 0));
  return { rows: list, unmatched };
}

/** Only SENT and PAID invoices count as bought; drafts and cancelled ones are ignored.
 * Loads the caller's invoice lines, deal items and adjustments (`owned` is the usual ownerScope) and computes stock. */
export async function loadStock(owned: OwnerScope) {
  const [invoiceItems, dealItems, adjustments] = await Promise.all([
    db.invoiceItem.findMany({
      where: { invoice: { ...owned, status: { in: ["SENT", "PAID"] } } },
      select: { style: true, description: true, color: true, lengthInches: true, quantity: true, invoice: { select: { id: true, number: true } } },
    }),
    db.dealItem.findMany({
      where: { deal: { ...owned, deletedAt: null, stage: { in: SOLD_STAGES } } },
      select: { productType: true, color: true, lengthInches: true, quantity: true, deal: { select: { id: true, title: true } } },
    }),
    db.stockAdjustment.findMany({ where: owned, orderBy: { createdAt: "asc" } }),
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
    adjustments,
  );
}

/** Most pieces a low-stock level can be set to. */
export const MAX_STOCK_LEVEL = 100_000;

/** A saved level for one stock row. `threshold` null means "use the business default"; 0 means "never alert". */
export type StockLevel = { key: string; threshold: number | null };

/** The level at which a row counts as low: its own setting, else the business default. A level of 0 never alerts. */
export const effectiveLevel = (own: number | null | undefined, defaultLevel: number) => own ?? defaultLevel;

/** Low means at or below the level (so a row that is out, or oversold, is low too). A level of 0 switches the row off. */
export const isLow = (onHand: number, level: number) => level > 0 && onHand <= level;

/** Stock rows with the level they are held to and whether they are low now. Rows with no saved level use the default. */
export function withLowStock<R extends { key: string; onHand: number }>(rows: R[], levels: StockLevel[], defaultLevel: number) {
  const own = new Map(levels.map((l) => [l.key, l.threshold]));
  return rows.map((r) => {
    const threshold = own.get(r.key) ?? null;
    const level = effectiveLevel(threshold, defaultLevel);
    return { ...r, threshold, level, low: isLow(r.onHand, level) };
  });
}
