/** Pure helpers for WhatsApp templates; safe to import from the browser as well as the server. */

/** Where the value for a template blank ({{1}}, {{2}}...) comes from when a message is sent. */
export const SLOT_SOURCES = {
  firstName: "Customer's first name",
  fullName: "Customer's full name",
  dealTitle: "Order or deal title",
  amountDue: "Amount due on the order",
  dueDate: "Next due date",
  trackingNumber: "Tracking number (typed when sending)",
  manual: "Typed when sending",
} as const;
export type SlotSource = keyof typeof SLOT_SOURCES;
export type Slot = { label: string; source: SlotSource };

export const SLOT_SOURCE_KEYS = Object.keys(SLOT_SOURCES) as [SlotSource, ...SlotSource[]];

/** The numbered blanks in a template body, in order and without repeats: "Hi {{1}}, {{2}}, {{1}}" gives [1, 2]. */
export function placeholderNumbers(body: string): number[] {
  const found = new Set<number>();
  for (const m of body.matchAll(/\{\{\s*(\d{1,2})\s*\}\}/g)) found.add(Number(m[1]));
  return [...found].sort((a, b) => a - b);
}

/** Meta wants the blanks numbered 1..n with no gaps. */
export const hasContiguousPlaceholders = (body: string) => placeholderNumbers(body).every((n, i) => n === i + 1);

/** A body that uses named blanks ({{first_name}}) instead of numbers: not supported here. */
export const hasNamedPlaceholders = (body: string) => /\{\{\s*[a-z_][\w]*\s*\}\}/i.test(body);

/** One starting slot per blank, so the admin only has to choose where each value comes from. */
export function defaultSlots(body: string): Slot[] {
  return placeholderNumbers(body).map((n) => ({ label: n === 1 ? "First name" : `Value ${n}`, source: n === 1 ? "firstName" : "manual" }));
}

/** Reads the stored slots back, repairing anything unexpected so a bad row never breaks the screen. */
export function readSlots(raw: unknown, body: string): Slot[] {
  const count = placeholderNumbers(body).length;
  const list = Array.isArray(raw) ? raw : [];
  const out: Slot[] = [];
  for (let i = 0; i < count; i++) {
    const s = list[i] as Partial<Slot> | undefined;
    const source = s?.source && s.source in SLOT_SOURCES ? s.source : "manual";
    out.push({ label: typeof s?.label === "string" && s.label.trim() ? s.label.trim().slice(0, 40) : `Value ${i + 1}`, source });
  }
  return out;
}

/** The body with each blank replaced by the given values (for the preview); a missing value stays as its blank. */
export function renderBody(body: string, values: string[]): string {
  return body.replace(/\{\{\s*(\d{1,2})\s*\}\}/g, (whole, n) => values[Number(n) - 1] ?? whole);
}
