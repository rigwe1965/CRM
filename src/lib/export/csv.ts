/**
 * CSV writing for exports (RFC 4180 quoting, UTF-8 BOM so Excel reads accents correctly).
 *
 * Spreadsheet formula injection: a text cell that starts with = + - @ (or a tab, CR or LF) is run as
 * a formula when the file is opened in Excel or Sheets, and customer-typed fields (names, notes) can
 * start with those characters. Such text gets a leading apostrophe so it stays text. Real numbers are
 * written as numbers and are never touched.
 */
export const CSV_BOM = "﻿";

const FORMULA = /^[\t\r\n ]*[=+\-@]|^[\t\r\n]/;
const NEEDS_QUOTES = /[",\r\n]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  // Prisma Decimal and friends: write the number, not text.
  if (typeof value === "object" && typeof (value as { toNumber?: unknown }).toNumber === "function") {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? String(n) : "";
  }
  let s = String(value);
  const guarded = FORMULA.test(s);
  if (guarded) s = `'${s}`;
  return guarded || NEEDS_QUOTES.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvLine = (cells: readonly unknown[]) => `${cells.map(csvCell).join(",")}\r\n`;
