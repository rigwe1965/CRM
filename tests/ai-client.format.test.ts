import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/client/api";
import { isAppPath, parseBlocks, parseInline, splitEvents, streamChat, type IvyEvent } from "@/lib/client/ivy";

const line = (e: unknown) => `${JSON.stringify(e)}\n`;

describe("splitEvents", () => {
  it("returns whole events and keeps the unfinished line for next time", () => {
    const a = splitEvents(`${line({ type: "text", delta: "Hel" })}{"type":"text","del`);
    expect(a.events).toEqual([{ type: "text", delta: "Hel" }]);
    expect(a.rest).toBe('{"type":"text","del');
    const b = splitEvents(`${a.rest}ta":"lo"}\n`);
    expect(b.events).toEqual([{ type: "text", delta: "lo" }]);
    expect(b.rest).toBe("");
  });

  it("skips garbage, blank lines and event types it does not know, without losing the rest", () => {
    const out = splitEvents(`not json\n\n${line({ type: "mystery" })}${line({ type: "done" })}${line("a string")}`);
    expect(out.events).toEqual([{ type: "done" }]);
  });
});

describe("parseInline: only bold and in-app links get through", () => {
  it("makes bold and plain text", () => {
    expect(parseInline("You are owed **$450 USD** by Ada")).toEqual([
      { kind: "text", text: "You are owed " },
      { kind: "bold", text: "$450 USD" },
      { kind: "text", text: " by Ada" },
    ]);
  });

  it("links to a contact by id and to the main pages", () => {
    expect(parseInline("[Ada](/contacts/ckx9_a-1) and [stock](/stock)")).toEqual([
      { kind: "link", text: "Ada", href: "/contacts/ckx9_a-1" },
      { kind: "text", text: " and " },
      { kind: "link", text: "stock", href: "/stock" },
    ]);
  });

  it("shows only the label for a link anywhere else, so no external address can reach the page", () => {
    for (const href of ["https://evil.example/steal", "http://evil.example", "//evil.example", "javascript:alert(1)", "data:text/html,<script>", "/contacts/../settings", "/api/export", "/contacts/", "/contacts/a/b", "/deals?x=1", "/settings#x", "mailto:a@b.c"]) {
      const out = parseInline(`[click here](${href})`);
      expect(out, href).toEqual([{ kind: "text", text: "click here" }]);
    }
  });

  it("never renders an image, not even from the app: only its description as text", () => {
    expect(parseInline("![the chart](https://evil.example/x.png?leak=1)")).toEqual([{ kind: "text", text: "the chart" }]);
    expect(parseInline("![](https://evil.example/x.png)")).toEqual([]);
    expect(parseInline("![a](/stock)")).toEqual([{ kind: "text", text: "a" }]);
  });

  it("leaves HTML as literal text, which React then escapes", () => {
    const out = parseInline("<script>alert(1)</script> <img src=x onerror=alert(1)>");
    expect(out).toEqual([{ kind: "text", text: "<script>alert(1)</script> <img src=x onerror=alert(1)>" }]);
  });

  it("isAppPath accepts only the fixed list", () => {
    for (const ok of ["/deals", "/contacts/abc123", "/reports"]) expect(isAppPath(ok)).toBe(true);
    for (const no of ["/", "/api/me", "/admin", "/deals/x", "https://x.test/deals", "deals"]) expect(isAppPath(no)).toBe(false);
  });
});

describe("parseBlocks", () => {
  it("splits paragraphs, bullet lists and numbered lists", () => {
    const out = parseBlocks("Two are late.\n\n- **Ada**: $450 USD\n- **Bola**: €100 EUR\n\n1. Call Ada\n2. Email Bola");
    expect(out.map((b) => b.kind)).toEqual(["p", "ul", "ol"]);
    expect(out[1]).toMatchObject({ kind: "ul", items: [[{ kind: "bold", text: "Ada" }, { kind: "text", text: ": $450 USD" }], expect.any(Array)] });
    expect((out[2] as { items: unknown[] }).items).toHaveLength(2);
  });

  it("keeps a line that merely looks like part of a list as a paragraph if the rest is not", () => {
    expect(parseBlocks("- one\nand some text")[0].kind).toBe("p");
  });

  it("copes with empty text and Windows line endings", () => {
    expect(parseBlocks("")).toEqual([]);
    expect(parseBlocks("a\r\n\r\nb").map((b) => b.kind)).toEqual(["p", "p"]);
  });
});

describe("streamChat", () => {
  afterEach(() => vi.unstubAllGlobals());

  const bodyOf = (chunks: string[]) => {
    const enc = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(c) {
        chunks.forEach((ch) => c.enqueue(enc.encode(ch)));
        c.close();
      },
    });
  };

  it("posts the question and reports events, even when one is split across chunks", async () => {
    const fetchMock = vi.fn(async () => new Response(bodyOf([line({ type: "conversation", id: "c1", title: "t" }), '{"type":"text","de', 'lta":"Hi"}\n{"type":"done"}\n']), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const got: IvyEvent[] = [];
    await streamChat({ conversationId: "c1", message: "hello" }, (e) => got.push(e));
    expect(got).toEqual([{ type: "conversation", id: "c1", title: "t" }, { type: "text", delta: "Hi" }, { type: "done" }]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/assistant/chat");
    expect(JSON.parse(init.body as string)).toEqual({ conversationId: "c1", message: "hello" });
  });

  it("rejects with the server's code when it refuses before streaming", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "AI is switched off", code: "AI_DISABLED" }), { status: 403 })));
    await expect(streamChat({ message: "hi" }, () => undefined)).rejects.toMatchObject({ status: 403, code: "AI_DISABLED", message: "AI is switched off" });
    await expect(streamChat({ message: "hi" }, () => undefined)).rejects.toBeInstanceOf(ApiClientError);
  });

  it("rejects with a network error when the request cannot be made", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    await expect(streamChat({ message: "hi" }, () => undefined)).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("returns quietly when the person stops the answer", async () => {
    const abort = new AbortController();
    abort.abort();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new DOMException("aborted", "AbortError"))));
    await expect(streamChat({ message: "hi" }, () => undefined, abort.signal)).resolves.toBeUndefined();
  });
});
