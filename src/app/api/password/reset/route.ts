import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { apiError, parseBody } from "@/lib/api";
import { hashPassword } from "@/lib/password";
import { clientIp, LIMITS, rateLimit } from "@/lib/rate-limit";
import { consumePasswordResetToken } from "@/lib/tokens";
import { resetPasswordSchema } from "@/lib/validations/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const limit = await rateLimit(`reset:${clientIp(req.headers)}`, LIMITS.passwordReset);
  if (!limit.allowed) return apiError(`Too many attempts. Try again in ${limit.retryAfter}s.`, 429);
  const body = await parseBody(req, resetPasswordSchema);
  if ("response" in body) return body.response;

  const email = await consumePasswordResetToken(body.data.token);
  if (!email) return apiError("This reset link is invalid or has expired.", 400);

  // passwordChangedAt invalidates every session issued before the reset.
  const { count } = await db.user.updateMany({
    where: { email, isActive: true },
    data: { passwordHash: await hashPassword(body.data.password), passwordChangedAt: new Date() },
  });
  if (count === 0) return apiError("This reset link is invalid or has expired.", 400);
  return NextResponse.json({ ok: true });
}
