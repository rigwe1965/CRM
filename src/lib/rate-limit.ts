import { ApiError } from "@/lib/api";

/**
 * Fixed-window rate limiter.
 *  - With UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN the counters are shared by every
 *    serverless instance (use this in production on Vercel).
 *  - Otherwise counters live in process memory: fine for `next dev` and a single server, but
 *    each serverless instance keeps its own count, so limits are only best-effort.
 * If Redis is unreachable the error is logged and the request is allowed (fail open), except for
 * limits marked `failClosed` (sign-in, password reset, magic link), which block instead.
 */

type Result = { allowed: boolean; retryAfter: number };

const memory = new Map<string, { count: number; resetAt: number }>();

function memoryHit(key: string, windowMs: number, max: number): Result {
  const now = Date.now();
  if (memory.size > 5000) for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
  let entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    memory.set(key, entry);
  }
  entry.count++;
  return { allowed: entry.count <= max, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
}

async function redisHit(key: string, windowMs: number, max: number): Promise<Result> {
  const url = process.env.UPSTASH_REDIS_REST_URL!;
  const windowSec = Math.ceil(windowMs / 1000);
  const bucket = `rl:${key}:${Math.floor(Date.now() / windowMs)}`;
  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify([["INCR", bucket], ["EXPIRE", bucket, String(windowSec), "NX"]]),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Upstash responded ${res.status}`);
  const [incr] = (await res.json()) as Array<{ result: number }>;
  return { allowed: incr.result <= max, retryAfter: windowSec - (Math.floor(Date.now() / 1000) % windowSec) };
}

export async function rateLimit(key: string, opts: { max: number; windowMs: number; failClosed?: boolean }): Promise<Result> {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    try {
      return await redisHit(key, opts.windowMs, opts.max);
    } catch (e) {
      console.error("[rate-limit] redis failed", opts.failClosed ? "(blocking)" : "(allowing)", e instanceof Error ? e.message : e);
      return opts.failClosed ? { allowed: false, retryAfter: 60 } : { allowed: true, retryAfter: 0 };
    }
  }
  return memoryHit(key, opts.windowMs, opts.max);
}

/**
 * Client IP for rate limiting. X-Forwarded-For is client-controlled except for what OUR proxies
 * append, so the leftmost entry can be forged. We read from the right instead:
 *  - On Vercel the platform overwrites the header: its single value is the client.
 *  - Elsewhere set TRUSTED_PROXY_COUNT to the number of reverse proxies in front of the app
 *    (default 1, e.g. nginx or a load balancer): the entry that many places from the right is the
 *    address the outermost trusted proxy saw. The app must not be reachable directly, bypassing them.
 */
export function clientIp(headers: Headers): string {
  const forwarded = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (forwarded.length) {
    if (process.env.VERCEL) return forwarded[0];
    const proxies = Math.max(1, Number.parseInt(process.env.TRUSTED_PROXY_COUNT ?? "1", 10) || 1);
    return forwarded[Math.max(0, forwarded.length - proxies)];
  }
  return headers.get("x-real-ip") || "unknown";
}

export const LIMITS = {
  // The sign-in form calls mfa-check and then sign-in, so one honest login counts twice.
  signIn: { max: 15, windowMs: 15 * 60_000, failClosed: true },
  /** Per account across all IPs: stops a distributed guessing attack that rotates addresses. */
  signInAccount: { max: 40, windowMs: 60 * 60_000, failClosed: true },
  passwordForgot: { max: 5, windowMs: 60 * 60_000, failClosed: true },
  passwordReset: { max: 10, windowMs: 60 * 60_000, failClosed: true },
  magicLink: { max: 5, windowMs: 15 * 60_000, failClosed: true },
  sendEmail: { max: 30, windowMs: 60 * 60_000 },
  /** Two-step setup/disable attempts per user. */
  mfa: { max: 10, windowMs: 15 * 60_000, failClosed: true },
  /** Every authenticated API call, per user (reads and writes counted separately). */
  apiRead: { max: 600, windowMs: 60_000 },
  apiWrite: { max: 120, windowMs: 60_000 },
} as const;

/** Throws ApiError(429) when over the limit. For handlers that already catch ApiError. */
export async function enforceRateLimit(key: string, opts: { max: number; windowMs: number; failClosed?: boolean }) {
  const r = await rateLimit(key, opts);
  if (!r.allowed) throw new ApiError(429, `Too many requests. Try again in ${r.retryAfter}s.`, "RATE_LIMITED");
}
