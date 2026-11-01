// Reads a customer list (CSV or .xlsx) into contacts. Runs in the browser; nothing is uploaded until the person has
// looked at the preview and pressed Import, and the server checks every row again.
import { MAX_IMPORT_BYTES, parseCsv, readTable } from "@/lib/client/invoice-import";

export { MAX_IMPORT_BYTES, parseCsv, readTable };

export const MAX_CONTACT_ROWS = 500;

export type ImportedContact = { firstName: string; lastName: string; email: string; phone: string; city: string; state: string; country: string };
export type ContactImportResult = {
  rows: ImportedContact[];
  /** Rows left out because they had no name. */
  skipped: number;
  /** Rows beyond the first 500, which are not read. */
  extra: number;
  headerRow: number;
};

type Field = "firstName" | "lastName" | "name" | "email" | "phone" | "city" | "state" | "country";

// Header names seen on customer lists, lower-cased with punctuation removed.
const ALIASES: Record<Field, string[]> = {
  firstName: ["first name", "firstname", "first", "given name", "forename"],
  lastName: ["last name", "lastname", "last", "surname", "family name"],
  name: ["name", "full name", "fullname", "customer", "customer name", "client", "client name", "contact", "contact name"],
  email: ["email", "e-mail", "email address", "mail", "e mail"],
  phone: ["phone", "phone number", "mobile", "mobile number", "telephone", "tel", "cell", "whatsapp", "whatsapp number", "contact number"],
  city: ["city", "town"],
  state: ["state", "province", "region"],
  country: ["country"],
};

const norm = (v: unknown) =>
  String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function matchField(header: unknown): Field | null {
  const h = norm(header);
  if (!h) return null;
  for (const [field, names] of Object.entries(ALIASES) as [Field, string[]][]) {
    if (names.some((n) => norm(n) === h)) return field;
  }
  return null;
}

/** A phone cell read as a number loses its leading zero or "+": keep what is there as text. */
const cell = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "number" ? String(Math.trunc(v)) : String(v).trim());

/**
 * Finds the header row, maps columns by name, and turns each data row into a contact. A single "Name" column is split
 * at the first space ("Ada Okafor-Eze" has first name "Ada"); a one-word name gets "-" as last name, like contacts
 * created from a WhatsApp message. Throws when no column holds a name.
 */
export function tableToContacts(table: unknown[][]): ContactImportResult {
  let headerRow = -1;
  let cols: Partial<Record<Field, number>> = {};
  for (let r = 0; r < Math.min(table.length, 10); r++) {
    const found: Partial<Record<Field, number>> = {};
    table[r].forEach((c, i) => {
      const f = matchField(c);
      if (f && found[f] === undefined) found[f] = i;
    });
    if (found.firstName !== undefined || found.name !== undefined) {
      headerRow = r;
      cols = found;
      break;
    }
  }
  if (headerRow === -1) {
    throw new Error("Could not find a name column. Put a header row first with a column called Name (or First name and Last name), and Email and Phone if you have them.");
  }

  const get = (row: unknown[], f: Field) => (cols[f] === undefined ? "" : cell(row[cols[f]!]));
  const rows: ImportedContact[] = [];
  let skipped = 0;
  let extra = 0;
  for (const row of table.slice(headerRow + 1)) {
    if (!row || row.every((c) => cell(c) === "")) continue;
    if (rows.length >= MAX_CONTACT_ROWS) {
      extra++;
      continue;
    }
    let firstName = get(row, "firstName");
    let lastName = get(row, "lastName");
    if (!firstName) {
      const [first, ...rest] = get(row, "name").replace(/\s+/g, " ").split(" ");
      firstName = first ?? "";
      if (!lastName) lastName = rest.join(" ");
    }
    if (!firstName) {
      skipped++;
      continue;
    }
    rows.push({ firstName, lastName: lastName || "-", email: get(row, "email").toLowerCase(), phone: get(row, "phone"), city: get(row, "city"), state: get(row, "state"), country: get(row, "country") });
  }
  return { rows, skipped, extra, headerRow };
}

/** Reads a chosen file into contacts. */
export async function readContactFile(file: File): Promise<ContactImportResult> {
  return tableToContacts(await readTable(file));
}
