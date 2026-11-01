import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildEnvelope, parseDsn, reportError, resetReportLimit, routeOf, scrub } from "@/lib/error-report";

const DSN = "https://abc123publickey@o42.ingest.sentry.test/987";
const prod = { NODE_ENV: "production", SENTRY_DSN: DSN };

beforeEach(() => {
  resetReportLimit();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
});
afterEach(() => vi.unstubAllGlobals());

describe("error reporting", () => {
  it("parses a DSN into the envelope endpoint and rejects bad ones", () => {
    expect(parseDsn(DSN)).toMatchObject({ endpoint: "https://o42.ingest.sentry.test/api/987/envelope/", publicKey: "abc123publickey" });
    expect(parseDsn("http://k@host/1")).toBeNull(); // not https
    expect(parseDsn("https://host/1")).toBeNull(); // no key
    expect(parseDsn("https://k@host/abc")).toBeNull(); // project is not a number
    expect(parseDsn(undefined)).toBeNull();
  });

  it("removes personal data and credentials from messages", () => {
    const out = scrub("Failed for nia@fresh.test phone +234 801 111 2222 with sk_live_abcdefgh12345678 and Bearer abc.def.ghi and token AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    for (const leaked of ["nia@fresh.test", "801 111 2222", "sk_live_abcdefgh12345678", "abc.def.ghi", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"]) expect(out).not.toContain(leaked);
    expect(out).toContain("[email]");
  });

  it("keeps only the route pattern: no ids, no query string", () => {
    expect(routeOf("/api/deals/clx9abcdefghijklmnop12345/payments?email=nia@fresh.test&token=secret")).toBe("/api/deals/:id/payments");
    expect(routeOf("/contacts/123456")).toBe("/contacts/:id");
  });

  it("builds a three-line envelope with the error, a scrubbed message and nothing from the request", () => {
    const err = new Error("could not email nia@fresh.test");
    const { body } = buildEnvelope(err, { method: "POST", path: "/api/contacts/clx9abcdefghijklmnop12345/email?x=1", routeType: "route" }, parseDsn(DSN)!);
    const [header, item, event] = body.split("\n").map((l) => JSON.parse(l));
    expect(header.dsn).toBe("https://abc123publickey@o42.ingest.sentry.test/987");
    expect(item).toEqual({ type: "event" });
    expect(event.exception.values[0]).toMatchObject({ type: "Error", value: "could not email [email]" });
    expect(event.request).toEqual({ method: "POST", url: "/api/contacts/:id/email" });
    expect(JSON.stringify(event)).not.toMatch(/nia@fresh|clx9abc|x=1|cookie|authorization/i);
  });

  it("does nothing outside production or without a DSN", async () => {
    expect(await reportError(new Error("x"), {}, { NODE_ENV: "development", SENTRY_DSN: DSN })).toBe(false);
    expect(await reportError(new Error("x"), {}, { NODE_ENV: "production" })).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts to the project endpoint with the public key only", async () => {
    expect(await reportError(new Error("boom"), { method: "GET", path: "/dashboard" }, prod)).toBe(true);
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://o42.ingest.sentry.test/api/987/envelope/");
    expect((init.headers as Record<string, string>)["X-Sentry-Auth"]).toContain("sentry_key=abc123publickey");
  });

  it("never throws when the service is down, and caps a crash loop", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    await expect(reportError(new Error("boom"), {}, prod)).resolves.toBe(false);
    vi.mocked(fetch).mockResolvedValue(new Response("{}"));
    resetReportLimit();
    const results = await Promise.all(Array.from({ length: 30 }, () => reportError(new Error("loop"), {}, prod, 1_000_000)));
    expect(results.filter(Boolean)).toHaveLength(20);
  });
});
