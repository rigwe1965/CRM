import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { encryptSecret, generateSecret, otpauthUrl } from "@/lib/mfa";
import { verifyPassword } from "@/lib/password";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { mfaSetupSchema } from "@/lib/validations/auth";

export const dynamic = "force-dynamic";

/** POST /api/me/mfa/setup { password }: start enrolment. Stores a pending secret; it only counts once /enable confirms a code. */
export const POST = authed(async ({ req, user }) => {
  const { password } = await readBody(req, mfaSetupSchema);
  await enforceRateLimit(`mfa:${user.id}`, LIMITS.mfa);
  const me = await db.user.findUnique({ where: { id: user.id }, select: { email: true, mfaEnabledAt: true, passwordHash: true } });
  if (!me) throw new ApiError(401, "Unauthorized");
  // The password is asked again: a hijacked session must not be able to put its own authenticator on the account.
  if (!me.passwordHash) throw new ApiError(422, "Set a password first (Settings → Security), then turn on two-step verification.", "VALIDATION_ERROR", { password: ["Set a password first"] });
  if (!(await verifyPassword(password, me.passwordHash))) throw new ApiError(400, "That password is not right", "BAD_REQUEST", { password: ["That password is not right"] });
  if (me.mfaEnabledAt) throw new ApiError(409, "Two-step verification is already on. Turn it off first to set it up again.");

  const secret = generateSecret();
  await db.user.update({ where: { id: user.id }, data: { mfaSecret: encryptSecret(secret), mfaLastStep: null } });
  return NextResponse.json({ secret, otpauthUrl: otpauthUrl(me.email, secret) });
});
