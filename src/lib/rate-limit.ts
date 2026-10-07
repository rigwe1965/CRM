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

/** Client IP. On Vercel, x-forwarded-for is set by the platform and can be trusted. */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}

export const LIMITS = {
  signIn: { max: 10, windowMs: 15 * 60_000, failClosed: true },
  passwordForgot: { max: 5, windowMs: 60 * 60_000, failClosed: true },
  passwordReset: { max: 10, windowMs: 60 * 60_000, failClosed: true },
  magicLink: { max: 5, windowMs: 15 * 60_000, failClosed: true },
  sendEmail: { max: 30, windowMs: 60 * 60_000 },
} as const;

/** Throws ApiError(429) when over the limit. For handlers that already catch ApiError. */
export async function enforceRateLimit(key: string, opts: { max: number; windowMs: number; failClosed?: boolean }) {
  const r = await rateLimit(key, opts);
  if (!r.allowed) throw new ApiError(429, `Too many requests. Try again in ${r.retryAfter}s.`, "RATE_LIMITED");
}
