/**
 * Rejected webhook deliveries (bad or missing signature, unknown business, throttled), counted per kind and reason and
 * written to the log as one summary line at most once a minute. A burst of rejections is the signal worth alerting on
 * (a wrong secret after a rotation, or someone probing); set the alert in the log or error tracker, not here. Counts are
 * per server process, so on serverless they are best-effort.
 */
const WINDOW_MS = 60_000;

let windowStart = 0;
let counts = new Map<string, number>();

export function noteWebhookRejected(kind: string, reason: "bad_signature" | "not_configured" | "throttled", now = Date.now()) {
  if (windowStart && now - windowStart >= WINDOW_MS) flush();
  if (!windowStart) windowStart = now;
  const key = `${kind}:${reason}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function flush() {
  if (counts.size > 0) {
    const parts = [...counts].map(([k, n]) => `${k}=${n}`).join(" ");
    console.warn(`[webhook] rejected in the last minute: ${parts}`);
  }
  counts = new Map();
  windowStart = 0;
}

/** For tests. */
export const flushWebhookStats = flush;
