import { createHash, randomBytes } from "crypto";
import { db } from "@/lib/db";

// Reset tokens reuse the VerificationToken table. The identifier is prefixed so they can
// never collide with Auth.js magic-link tokens, and only a SHA-256 hash is stored.
const PREFIX = "reset:";
const TTL_MS = 60 * 60 * 1000;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export async function createPasswordResetToken(email: string): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  const identifier = PREFIX + email;
  await db.$transaction([
    db.verificationToken.deleteMany({ where: { identifier } }),
    db.verificationToken.create({
      data: { identifier, token: sha256(raw), expires: new Date(Date.now() + TTL_MS) },
    }),
  ]);
  return raw;
}

/** Atomically consumes the token (single use). Returns the email, or null if invalid/expired. */
export async function consumePasswordResetToken(raw: string): Promise<string | null> {
  const token = sha256(raw);
  const record = await db.verificationToken.findUnique({ where: { token } });
  if (!record || !record.identifier.startsWith(PREFIX)) return null;
  const { count } = await db.verificationToken.deleteMany({
    where: { token, expires: { gt: new Date() } },
  });
  if (count === 0) return null;
  await db.verificationToken.deleteMany({ where: { identifier: record.identifier } });
  return record.identifier.slice(PREFIX.length);
}
