import { createHash, randomBytes } from "crypto";
import { platformDb } from "@/lib/platform-db";

// Reset tokens reuse the VerificationToken table. The identifier is prefixed so they can
// never collide with Auth.js magic-link tokens, and only a SHA-256 hash is stored.
const PREFIX = "reset:";
const TTL_MS = 60 * 60 * 1000;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function issue(prefix: string, email: string, ttlMs: number): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  const identifier = prefix + email;
  await platformDb.$transaction([
    platformDb.verificationToken.deleteMany({ where: { identifier } }),
    platformDb.verificationToken.create({
      data: { identifier, token: sha256(raw), expires: new Date(Date.now() + ttlMs) },
    }),
  ]);
  return raw;
}

/** Atomically consumes a token (single use). Returns the email, or null if invalid/expired/of another kind. */
async function consume(prefix: string, raw: string): Promise<string | null> {
  const token = sha256(raw);
  const record = await platformDb.verificationToken.findUnique({ where: { token } });
  if (!record || !record.identifier.startsWith(prefix)) return null;
  const { count } = await platformDb.verificationToken.deleteMany({
    where: { token, expires: { gt: new Date() } },
  });
  if (count === 0) return null;
  await platformDb.verificationToken.deleteMany({ where: { identifier: record.identifier } });
  return record.identifier.slice(prefix.length);
}

export const createPasswordResetToken = (email: string, ttlMs = TTL_MS) => issue(PREFIX, email, ttlMs);
export const consumePasswordResetToken = (raw: string) => consume(PREFIX, raw);

// Email confirmation for a self-service signup (Phase 4). Its own prefix, so a reset link can't confirm a signup or the reverse.
export const SIGNUP_TTL_MS = 24 * 60 * 60 * 1000;
export const createSignupToken = (email: string) => issue("signup:", email, SIGNUP_TTL_MS);
export const consumeSignupToken = (raw: string) => consume("signup:", raw);
