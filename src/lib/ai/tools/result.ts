/** The most characters of a tool's answer that go to the model: enough to answer a question, not to dump a table. */
export const MAX_RESULT_CHARS = 8000;

/** Free text from a record (a note, a title) is cut short and tidied before the model sees it. */
export const clip = (s: string | null | undefined, max = 160): string | null => {
  if (!s) return null;
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

export const fullName = (p: { firstName: string; lastName: string } | null | undefined) => (p ? `${p.firstName} ${p.lastName}`.trim() : null);

export const isoDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * Turns a tool's answer into the text the model reads. Over the cap, the longest list in the answer is halved until
 * it fits and the answer says so (`truncated`, `shown`), so the model never mistakes a cut-off list for the whole.
 */
export function resultText(value: unknown, max = MAX_RESULT_CHARS): string {
  let text = JSON.stringify(value);
  if (text.length <= max || typeof value !== "object" || value === null || Array.isArray(value)) return text.length <= max ? text : `${text.slice(0, max - 1)}…`;

  const out = { ...(value as Record<string, unknown>) };
  for (let guard = 0; guard < 12 && text.length > max; guard++) {
    const longest = Object.entries(out)
      .filter(([, v]) => Array.isArray(v) && v.length > 1)
      .sort(([, a], [, b]) => (b as unknown[]).length - (a as unknown[]).length)[0];
    if (!longest) break;
    const [key, list] = longest as [string, unknown[]];
    out[key] = list.slice(0, Math.ceil(list.length / 2));
    out.truncated = true;
    out.shown = { ...((out.shown as object | undefined) ?? {}), [key]: (out[key] as unknown[]).length };
    text = JSON.stringify(out);
  }
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
