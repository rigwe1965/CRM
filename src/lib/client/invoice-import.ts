// Reads a supplier price sheet (CSV or .xlsx) into invoice lines. Runs in the browser; nothing is
// uploaded until the user reviews the lines in the New invoice form and saves.

export type ImportedItem = {
  ref: string;
  style: string;
  description: string;
  color: string;
  density: string;
  lengthInches: number | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number | null;
  resalePrice: number | null;
  note: string;
};

export type ImportResult = { items: ImportedItem[]; skipped: number; headerRow: number };

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 500;

type Field = "ref" | "style" | "description" | "color" | "density" | "length" | "quantity" | "unitPrice" | "lineTotal" | "resalePrice" | "note";

// Header names seen on supplier sheets, lower-cased with punctuation removed.
const ALIASES: Record<Field, string[]> = {
  ref: ["ref", "serial", "serialnumber", "serialno", "no", "line", "item no", "itemno", "sn", "s/n"],
  style: ["style", "picture", "product", "category", "type", "name"],
  description: ["description", "items", "item", "details", "model"],
  color: ["color", "colour"],
  density: ["density", "weight", "grams"],
  length: ["length", "size", "inch", "inches"],
  quantity: ["qty", "quantity", "orderqty", "orderqtypcs", "pcs", "pieces", "order qty"],
  unitPrice: ["unitprice", "unit price", "price", "unitpricespcs", "unite price", "uniteprice", "unit"],
  lineTotal: ["total", "totally", "linetotal", "amount", "line total"],
  resalePrice: ["resale", "resaleprice", "sellprice", "sellingprice", "retail", "retailprice"],
  note: ["note", "notes", "tips", "remark", "remarks", "comment"],
};

const norm = (v: unknown) =>
  String(v ?? "")
    .toLowerCase()
    .replace(/\(.*?\)/g, "") // "Order Qty (PCs)" -> "order qty"
    .replace(/[^a-z0-9/ ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

function matchField(header: unknown): Field | null {
  const h = norm(header);
  if (!h) return null;
  const compact = h.replace(/ /g, "");
  for (const [field, names] of Object.entries(ALIASES) as [Field, string[]][]) {
    if (names.some((n) => n === h || n.replace(/ /g, "") === compact)) return field;
  }
  return null;
}

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const cleaned = text(v).replace(/[^0-9.,-]/g, "");
  if (!cleaned) return null;
  // "1,234.50" -> 1234.50; a lone comma with 1-2 decimals ("12,5") is a decimal comma.
  const n = /,\d{1,2}$/.test(cleaned) && !cleaned.includes(".") ? Number(cleaned.replace(",", ".")) : Number(cleaned.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Splits CSV text into rows, handling quotes and ; or tab separators. */
export function parseCsv(input: string): string[][] {
  const textIn = input.replace(/^﻿/, "");
  const firstLine = textIn.split(/\r?\n/, 1)[0] ?? "";
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const delim = [",", ";", "\t"].sort((a, b) => count(b) - count(a))[0];

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < textIn.length; i++) {
    const ch = textIn[i];
    if (quoted) {
      if (ch === '"' && textIn[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true; // a quote mid-cell (14") is just text
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && textIn[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Reads the first sheet of a .csv or .xlsx file into a grid of cells. */
export async function readTable(file: File): Promise<unknown[][]> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error("That file is too big (limit 5 MB).");
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt") || file.type === "text/csv") {
    return parseCsv(await file.text());
  }
  if (name.endsWith(".xlsx")) {
    const { readSheet } = await import("read-excel-file/browser");
    return (await readSheet(file)) as unknown[][];
  }
  throw new Error("Choose a .csv or .xlsx file. (For an old .xls file, save it as .xlsx first.)");
}

/**
 * Finds the header row, maps columns by name, and turns each data row into a line. Cells left
 * blank under a merged cell (style, description, colour) take the value from the line above.
 * Rows without a quantity and unit price (totals, blank lines) are skipped and counted.
 */
export function tableToItems(table: unknown[][]): ImportResult {
  let headerRow = -1;
  let cols: Partial<Record<Field, number>> = {};
  for (let r = 0; r < Math.min(table.length, 15); r++) {
    const found: Partial<Record<Field, number>> = {};
    table[r].forEach((cell, c) => {
      const f = matchField(cell);
      if (f && found[f] === undefined) found[f] = c;
    });
    if (found.quantity !== undefined && found.unitPrice !== undefined) {
      headerRow = r;
      cols = found;
      break;
    }
  }
  if (headerRow < 0) {
    throw new Error("Couldn't find the header row. The sheet needs columns for quantity and unit price (e.g. 'Order Qty' and 'Unit Price').");
  }

  const get = (row: unknown[], f: Field) => (cols[f] === undefined ? undefined : row[cols[f]!]);
  const items: ImportedItem[] = [];
  let skipped = 0;
  let style = "";
  let description = "";
  let color = "";
  let lineNo = 0;

  for (const row of table.slice(headerRow + 1)) {
    if (row.every((c) => text(c) === "")) continue;
    // Carry merged-cell values down only while the row is otherwise a real line.
    const quantity = num(get(row, "quantity"));
    const unitPrice = num(get(row, "unitPrice"));
    if (text(get(row, "style"))) style = text(get(row, "style"));
    if (text(get(row, "description"))) description = text(get(row, "description"));
    if (text(get(row, "color"))) color = text(get(row, "color"));
    if (!quantity || quantity < 1 || !Number.isInteger(quantity) || unitPrice === null || unitPrice < 0) {
      skipped++;
      continue;
    }
    lineNo++;
    const lengthMatch = text(get(row, "length")).match(/\d+/);
    items.push({
      ref: text(get(row, "ref")) || String(lineNo),
      style: style || description || "Item",
      description: description || style || "Item",
      color,
      density: text(get(row, "density")),
      lengthInches: lengthMatch ? Number(lengthMatch[0]) : null,
      quantity,
      unitPrice,
      lineTotal: num(get(row, "lineTotal")),
      resalePrice: num(get(row, "resalePrice")),
      note: text(get(row, "note")),
    });
    if (items.length > MAX_ROWS) throw new Error(`Too many lines (limit ${MAX_ROWS}).`);
  }
  if (items.length === 0) throw new Error("No lines with a quantity and unit price were found below the header row.");
  return { items, skipped, headerRow: headerRow + 1 };
}
