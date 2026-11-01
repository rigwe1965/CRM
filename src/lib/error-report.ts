/**
 * Server error reporting to a Sentry-compatible endpoint, with no SDK. The official SDK was tried and left out: every
 * release pulls in dependencies that `npm audit` flags, which CI treats as a failure. This sends the same "envelope"
 * the SDK would, from the one place Next.js reports unhandled server errors (`onRequestError`, src/instrumentation.ts).
 *
 * It is off unless SENTRY_DSN is set and the server runs in production. Because this is a CRM, only what is needed to
 * find the bug leaves the server: the error type, a scrubbed message, the stack, the HTTP method and the route
 * *pattern* (never the real URL, query string, headers, cookies or body). Email addresses, phone numbers, keys and
 * long tokens are removed from messages. Sending never throws and never delays the response.
 */
type Dsn = { endpoint: string; publicKey: string; raw: string };

export function parseDsn(raw: string | undefined): Dsn | null {
  if (!raw || !URL.canParse(raw)) return null;
  const u = new URL(raw);
  const project = u.pathname.replace(/^\/+|\/+$/g, "").split("/").pop();
  if (u.protocol !== "https:" || !u.username || !project || !/^\d+$/.test(project)) return null;
  const prefix = u.pathname.replace(/\/+$/g, "").split("/").slice(0, -1).join("/");
  return { endpoint: `${u.protocol}//${u.host}${prefix}/api/${project}/envelope/`, publicKey: u.username, raw: `${u.protocol}//${u.username}@${u.host}${prefix}/${project}` };
}

const PATTERNS: Array<[RegExp, string]> = [
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]"],
  [/\b(?:sk|rk|pk|whsec|sk-ant)[-_](?:test|live)?[-_]?\w{8,}\b/gi, "[key]"],
  [/\bBearer\s+[\w.~+/=-]+/gi, "Bearer [token]"],
  [/\b[A-Za-z0-9_-]{32,}\b/g, "[token]"],
  [/\+?\d[\d\s().-]{7,}\d/g, "[number]"],
];

/** Removes anything that looks like personal data or a credential from text that is about to leave the server. */
export function scrub(text: string, max = 500): string {
  return PATTERNS.reduce((t, [re, to]) => t.replace(re, to), text).slice(0, max);
}

/** A route pattern with ids made generic ("/api/deals/abc123/payments" -> "/api/deals/:id/payments"), no query string. */
export function routeOf(path: string): string {
  return path
    .split("?")[0]
    .split("/")
    .map((seg) => (/^[A-Za-z0-9_-]{16,}$/.test(seg) || /^\d+$/.test(seg) ? ":id" : seg))
    .join("/");
}

function frames(stack: string | undefined) {
  const out: Array<{ function: string; filename: string; lineno?: number; colno?: number; in_app: boolean }> = [];
  for (const line of (stack ?? "").split("\n").slice(1, 40)) {
    const m = line.match(/^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/);
    if (!m) continue;
    const filename = m[2].replace(/^file:\/\/\/?/, "").replace(/^.*\/(?=src\/|node_modules\/|\.next\/)/, "");
    out.push({ function: m[1] ?? "<anonymous>", filename, lineno: Number(m[3]), colno: Number(m[4]), in_app: !filename.includes("node_modules") });
  }
  return out.reverse(); // Sentry wants the oldest call first
}

export type ReportContext = { method?: string; path?: string; routeType?: string };

/** The envelope body for one error. Pure, so it can be tested without a network. */
export function buildEnvelope(err: unknown, ctx: ReportContext, dsn: Dsn, env: { environment?: string; release?: string } = {}, now = new Date()) {
  const error = err instanceof Error ? err : new Error(typeof err === "string" ? err : "Non-error value thrown");
  const eventId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  const event = {
    event_id: eventId,
    timestamp: now.getTime() / 1000,
    platform: "node",
    level: "error",
    environment: env.environment ?? "production",
    ...(env.release && { release: env.release }),
    exception: { values: [{ type: scrub(error.name || "Error", 80), value: scrub(error.message), stacktrace: { frames: frames(error.stack) } }] },
    tags: { ...(ctx.method && { method: ctx.method }), ...(ctx.routeType && { routeType: ctx.routeType }) },
    request: ctx.path ? { method: ctx.method, url: routeOf(ctx.path) } : undefined,
  };
  return { eventId, body: [JSON.stringify({ event_id: eventId, sent_at: now.toISOString(), dsn: dsn.raw }), JSON.stringify({ type: "event" }), JSON.stringify(event)].join("\n") };
}

let sentThisMinute = 0;
let minuteStart = 0;
const MAX_PER_MINUTE = 20; // a crash loop must not turn into a flood of requests (or a bill)

/** Fire-and-forget. Resolves to whether a report was attempted; never throws. */
export async function reportError(err: unknown, ctx: ReportContext = {}, env: Record<string, string | undefined> = process.env, now = Date.now()): Promise<boolean> {
  try {
    if (env.NODE_ENV !== "production") return false;
    const dsn = parseDsn(env.SENTRY_DSN);
    if (!dsn) return false;
    if (now - minuteStart >= 60_000) [minuteStart, sentThisMinute] = [now, 0];
    if (sentThisMinute >= MAX_PER_MINUTE) return false;
    sentThisMinute++;
    const { body } = buildEnvelope(err, ctx, dsn, { environment: env.SENTRY_ENVIRONMENT || "production", release: env.VERCEL_GIT_COMMIT_SHA }, new Date(now));
    await fetch(dsn.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope", "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=ivycandy-crm/1.0` },
      body,
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    return true;
  } catch {
    return false; // reporting a failure must never become a failure
  }
}

/** For tests. */
export const resetReportLimit = () => ((sentThisMinute = 0), (minuteStart = 0));
