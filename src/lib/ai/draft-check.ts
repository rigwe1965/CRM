/**
 * A draft Ivy writes for a person to send (a reminder, a reply) is checked, not trusted: text that came from a customer's
 * message or a record can try to make her put a link, an email address or an account number into it. This finds those
 * things and says so on the card, unless they are already in what the CRM holds for that contact (`allowed`). It only
 * warns: the person reads the draft and decides.
 */
const URL = /\b(?:https?:\/\/|www\.)\S+/gi;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const DIGITS = /\+?\d[\d\s().-]{6,}\d/g; // seven or more digits, possibly spaced: a phone or an account number

const digitsOnly = (s: string) => s.replace(/\D/g, "");

/** Returns a plain-words warning, or null when the draft holds nothing it should not. */
export function flagForeignContent(text: string, allowed: (string | null | undefined)[] = []): string | null {
  const known = allowed.filter((a): a is string => !!a).map((a) => a.toLowerCase());
  const knownDigits = known.map(digitsOnly).filter((d) => d.length >= 7);
  const found: string[] = [];

  for (const raw of text.match(URL) ?? []) {
    const m = raw.replace(/[.,;)]+$/, "");
    if (!known.some((k) => k.includes(m.toLowerCase()))) found.push(`a link (${m.slice(0, 60)})`);
  }
  for (const m of text.match(EMAIL) ?? []) if (!known.some((k) => k.includes(m.toLowerCase()))) found.push(`an email address (${m})`);
  for (const m of text.match(DIGITS) ?? []) {
    const d = digitsOnly(m);
    if (d.length < 8) continue; // short runs are amounts and instalment numbers
    if (/^\s*\d{4}-\d{2}-\d{2}\s*$/.test(m) || /^\s*\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\s*$/.test(m)) continue; // dates
    if (!knownDigits.some((k) => k.endsWith(d) || d.endsWith(k))) found.push(`a long number (${m.trim().slice(0, 24)})`);
  }
  if (found.length === 0) return null;
  const list = [...new Set(found)].slice(0, 3).join(", ");
  return `This draft contains ${list} that is not from your records. Check it carefully before you send anything.`;
}
