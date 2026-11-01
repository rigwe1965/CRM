import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "crypto";

/** TOTP (RFC 6238: 6 digits, 30 s, SHA-1), compatible with Google Authenticator, Authy, 1Password etc. */
const STEP_SECONDS = 30;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s.toUpperCase().replace(/[^A-Z2-7]/g, "")) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const generateSecret = () => base32Encode(randomBytes(20));

export function totp(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

/**
 * Returns the matching time step (accepting one step either side for clock drift), or null.
 * Steps at or before `lastStep` are refused, so a code can't be used twice.
 */
export function verifyTotp(secret: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  const given = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(given)) return null;
  const cur = currentStep(now);
  for (const step of [cur - 1, cur, cur + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    const expected = totp(secret, step);
    if (timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return step;
  }
  return null;
}

export const otpauthUrl = (email: string, secret: string, issuer = "Ivycandy CRM") =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${email}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;

// ── Secret at rest: AES-256-GCM ──────────────────────────────────────────────────────────────
// Stored as "iv.tag.ciphertext" (legacy: key derived from the app secret) or "v2.iv.tag.ciphertext"
// (key from MFA_ENCRYPTION_KEY, 32+ random bytes in base64, expanded with HKDF). Set
// MFA_ENCRYPTION_KEY_PREVIOUS while rotating. Decryption accepts all three, and `decryptSecretInfo`
// says whether the stored value already uses the current key so callers can re-encrypt it.
const V2 = "v2.";

function legacyKey() {
  const s = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is required for two-step verification");
  return createHash("sha256").update(`mfa-secret:${s}`).digest();
}

function v2Key(raw: string) {
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length < 32) throw new Error("MFA_ENCRYPTION_KEY must be at least 32 bytes, base64 encoded");
  return Buffer.from(hkdfSync("sha256", bytes, "", "ivycandy-crm mfa secret v2", 32));
}

const seal = (key: Buffer, plain: string) => {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString("base64url")).join(".");
};

const open = (key: Buffer, payload: string) => {
  const [iv, tag, ct] = payload.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
};

export function encryptSecret(plain: string): string {
  const current = process.env.MFA_ENCRYPTION_KEY;
  return current ? V2 + seal(v2Key(current), plain) : seal(legacyKey(), plain);
}

export function decryptSecretInfo(stored: string): { plain: string; current: boolean } {
  if (!stored.startsWith(V2)) {
    // Legacy value. It is "current" only while no dedicated key is configured.
    return { plain: open(legacyKey(), stored), current: !process.env.MFA_ENCRYPTION_KEY };
  }
  const payload = stored.slice(V2.length);
  const candidates = [process.env.MFA_ENCRYPTION_KEY, process.env.MFA_ENCRYPTION_KEY_PREVIOUS].filter((k): k is string => !!k);
  if (candidates.length === 0) throw new Error("MFA_ENCRYPTION_KEY is required to read this secret");
  let lastError: unknown;
  for (const [i, raw] of candidates.entries()) {
    try {
      return { plain: open(v2Key(raw), payload), current: i === 0 };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

export const decryptSecret = (stored: string) => decryptSecretInfo(stored).plain;

// ── Recovery codes: shown once, stored as keyed hashes, single use ───────────────────────────
// New codes are stored as "v2:" + HMAC-SHA256 under a key derived from the same secret material as the two-step
// secrets, so a leaked database alone cannot be used to guess codes offline. Codes saved before that are plain SHA-256
// hashes: they still work, until used (`recoveryCodeHashes` lists both forms).
const normalizeRecovery = (c: string) => c.toLowerCase().replace(/[^a-z0-9]/g, "");
const legacyRecoveryHash = (c: string) => createHash("sha256").update(normalizeRecovery(c)).digest("hex");

const recoveryKeyFrom = (material: Buffer) => Buffer.from(hkdfSync("sha256", material, "", "ivycandy-crm recovery code v2", 32));
const keyedHash = (key: Buffer, c: string) => "v2:" + createHmac("sha256", key).update(normalizeRecovery(c)).digest("hex");

/** The key new codes are hashed with, then the ones older codes may have used (the previous key during a rotation, or the app secret before a dedicated key was set). */
function recoveryKeys(): Buffer[] {
  const keys: Buffer[] = [];
  for (const raw of [process.env.MFA_ENCRYPTION_KEY, process.env.MFA_ENCRYPTION_KEY_PREVIOUS]) if (raw) keys.push(recoveryKeyFrom(Buffer.from(raw, "base64")));
  try {
    keys.push(recoveryKeyFrom(legacyKey()));
  } catch {
    // no app secret configured: nothing older to match
  }
  return keys;
}

export const hashRecoveryCode = (c: string) => keyedHash(recoveryKeys()[0], c);

/** Every form a stored hash of this code may have: current keyed, older keys, then the old plain SHA-256. */
export const recoveryCodeHashes = (c: string) => [...recoveryKeys().map((k) => keyedHash(k, c)), legacyRecoveryHash(c)];

/** 15 characters of base32 (75 bits), shown as xxxxx-xxxxx-xxxxx. */
export function generateRecoveryCodes(n = 8): string[] {
  return Array.from({ length: n }, () => {
    const raw = base32Encode(randomBytes(10)).toLowerCase().slice(0, 15);
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}-${raw.slice(10)}`;
  });
}
