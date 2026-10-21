// Pure and shared by the browser and the server: no imports.

/** The words an admin can put in a template, shown to them as {firstName} and so on. */
export const TEMPLATE_WORDS = ["firstName", "lastName", "company", "senderName"] as const;
export type TemplateWord = (typeof TEMPLATE_WORDS)[number];

/**
 * Fills the template words from `vars`. A known word with no value becomes empty (a contact with no
 * company); anything else in braces is left exactly as written.
 */
export function fillTemplate(text: string, vars: Partial<Record<TemplateWord, string | null | undefined>>): string {
  return text.replace(/\{(\w+)\}/g, (whole, word: string) =>
    (TEMPLATE_WORDS as readonly string[]).includes(word) ? (vars[word as TemplateWord] ?? "") : whole,
  );
}

/** A subject must be one line: runs of whitespace (including line breaks) become one space. */
export const oneLineSubject = (s: string) => s.replace(/\s+/g, " ").trim();
