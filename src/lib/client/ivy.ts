import { ApiClientError } from "@/lib/client/api";

/** What the chat route streams (the server's own type is IvyEvent in src/lib/ai/ivy.ts; this is what the browser reads). */
export type IvyEvent =
  | { type: "conversation"; id: string; title: string }
  | { type: "text"; delta: string }
  | { type: "tool"; id: string; name: string; label: string; status: "start" | "done" | "error" }
  | { type: "done" }
  | { type: "error"; code: string; message: string };

export type IvyMessage = { role: "user" | "assistant"; text: string; tools: string[] };
export type IvyChat = { id: string; title: string; stale: boolean; full: boolean; messages: IvyMessage[] };
export type IvyChatSummary = { id: string; title: string; updatedAt: string };
export type IvyStatus = { ready: boolean; /** Whether people may have Ivy read an invoice from a PDF or photo. */ documents?: boolean; reason: "AI_DISABLED" | "AI_NOT_CONFIGURED" | "AI_CEILING_UNSET" | "AI_CEILING_REACHED" | null; resetsOn: string | null };

const KNOWN = new Set(["conversation", "text", "tool", "done", "error"]);

/** Splits received text into the complete events in it and the unfinished line to carry into the next chunk. Garbled lines are skipped. */
export function splitEvents(buffer: string): { events: IvyEvent[]; rest: string } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const events: IvyEvent[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as IvyEvent;
      if (e && typeof e === "object" && KNOWN.has(e.type)) events.push(e);
    } catch {
      // A line that is not JSON is ignored rather than breaking the whole answer.
    }
  }
  return { events, rest };
}

/** Asks Ivy and reports each event as it arrives. Rejects with ApiClientError when the server refuses before streaming (Ivy off, ceiling reached, ...). */
export async function streamChat(body: { conversationId?: string; message: string }, onEvent: (e: IvyEvent) => void, signal?: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/assistant/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  } catch {
    if (signal?.aborted) return;
    throw new ApiClientError(0, "Network error. Check your connection and try again.", "NETWORK");
  }
  if (!res.ok || !res.body) {
    const json = await res.json().catch(() => ({}));
    throw new ApiClientError(res.status, json.error ?? "Something went wrong. Please try again.", json.code ?? "ERROR");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const { events, rest } = splitEvents(buffer + decoder.decode(value, { stream: true }));
      buffer = rest;
      events.forEach(onEvent);
    }
    buffer += decoder.decode();
    splitEvents(`${buffer}\n`).events.forEach(onEvent);
  } catch {
    if (!signal?.aborted) throw new ApiClientError(0, "The connection dropped while Ivy was answering. Try again.", "NETWORK");
  }
}

// ── Showing Ivy's text safely ────────────────────────────────────────────────────────────────────────────────────

export type Inline = { kind: "text"; text: string } | { kind: "bold"; text: string } | { kind: "link"; text: string; href: string };
export type TextBlock = { kind: "p"; inline: Inline[] } | { kind: "ul" | "ol"; items: Inline[][] };

/** The only places a link may point: a contact by id, or one of the main pages. Nothing outside the app, ever. */
const APP_PATH = /^\/(contacts\/[A-Za-z0-9_-]+|companies|deals|invoices|stock|tasks|activities|reports|settings)$/;
export const isAppPath = (href: string) => APP_PATH.test(href);

// A link's address may hold one level of parentheses, so something like javascript:alert(1) is read whole, not cut off at the first ")".
const URL_PART = String.raw`(?:[^()\s]|\([^()\s]*\))*`;
const INLINE = new RegExp(String.raw`(!?\[[^\]]*\]\(${URL_PART}\))|(\*\*[^*\n]+\*\*)`, "g");
const LINK = new RegExp(String.raw`^!?\[([^\]]*)\]\((${URL_PART})\)$`);

/** `**bold**` and `[label](/app/path)` only. Images and links to anywhere else show just their label, as plain text. */
export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let at = 0;
  for (const m of s.matchAll(INLINE)) {
    if (m.index > at) out.push({ kind: "text", text: s.slice(at, m.index) });
    const token = m[0];
    if (token.startsWith("**")) {
      out.push({ kind: "bold", text: token.slice(2, -2) });
    } else {
      const parts = token.match(LINK)!;
      const label = parts[1];
      if (!token.startsWith("!") && isAppPath(parts[2])) out.push({ kind: "link", text: label || parts[2], href: parts[2] });
      else if (label) out.push({ kind: "text", text: label });
    }
    at = m.index + token.length;
  }
  if (at < s.length) out.push({ kind: "text", text: s.slice(at) });
  return out;
}

/** Paragraphs, `-` lists and `1.` lists. Anything else, HTML included, stays literal text that React escapes. */
export function parseBlocks(text: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  for (const chunk of text.replace(/\r/g, "").split(/\n{2,}/)) {
    const lines = chunk.split("\n").filter((l) => l.trim() !== "");
    if (lines.length === 0) continue;
    const bullets = lines.map((l) => l.match(/^\s*[-*•]\s+(.*)$/));
    const numbered = lines.map((l) => l.match(/^\s*\d+[.)]\s+(.*)$/));
    if (bullets.every(Boolean)) blocks.push({ kind: "ul", items: bullets.map((m) => parseInline(m![1])) });
    else if (numbered.every(Boolean)) blocks.push({ kind: "ol", items: numbered.map((m) => parseInline(m![1])) });
    else blocks.push({ kind: "p", inline: parseInline(lines.join("\n")) });
  }
  return blocks;
}
