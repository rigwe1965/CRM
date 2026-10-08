import { db } from "@/lib/db";
import { LIMITS, isKnownIp, rateLimit } from "@/lib/rate-limit";

/**
 * The three sign-in throttles shared by the credentials sign-in and the two-step pre-check:
 * per address+account, per address, and per account (the last one skipped for an address the account
 * has already signed in from, see `isKnownIp`). A blocked attempt is not told apart from a wrong password.
 */
export async function signInAllowed(ip: string, email: string): Promise<{ allowed: boolean; retryAfter: number }> {
  for (const [key, opts] of [
    [`signin:${ip}:${email}`, LIMITS.signIn],
    [`signin-ip:${ip}`, { ...LIMITS.signIn, max: 50 }],
  ] as const) {
    const r = await rateLimit(key, opts);
    if (!r.allowed) return r;
  }
  const account = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (account && (await isKnownIp(account.id, ip))) return { allowed: true, retryAfter: 0 };
  return rateLimit(`signin-account:${email}`, LIMITS.signInAccount);
}
