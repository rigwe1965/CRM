import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { apiError, parseBody } from "@/lib/api";
import { getDummyHash, verifyPassword } from "@/lib/password";
import { clientIp } from "@/lib/rate-limit";
import { signInAllowed } from "@/lib/signin-limits";
import { mfaCheckSchema } from "@/lib/validations/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/mfa-check { email, password }: tells the sign-in form whether to ask for a code.
 * It answers `mfa: true` only after the password is correct, so it can't be used to find out which
 * accounts exist or which have two-step verification. Shares the sign-in rate limits.
 */
export async function POST(req: Request) {
  const body = await parseBody(req, mfaCheckSchema);
  if ("response" in body) return body.response;
  const { email, password } = body.data;

  const ip = clientIp(await headers());
  const limit = await signInAllowed(ip, email);
  if (!limit.allowed) return apiError(`Too many attempts. Try again in ${limit.retryAfter}s.`, 429);

  const user = await db.user.findUnique({ where: { email }, select: { passwordHash: true, isActive: true, mfaEnabledAt: true } });
  const valid = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
  return NextResponse.json({ mfa: !!(user && user.passwordHash && valid && user.isActive && user.mfaEnabledAt) });
}
