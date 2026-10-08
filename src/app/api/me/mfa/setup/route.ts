import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { authed } from "@/lib/route";
import { encryptSecret, generateSecret, otpauthUrl } from "@/lib/mfa";

export const dynamic = "force-dynamic";

/** POST /api/me/mfa/setup: start enrolment. Stores a pending secret; it only counts once /enable confirms a code. */
export const POST = authed(async ({ user }) => {
  const me = await db.user.findUnique({ where: { id: user.id }, select: { email: true, mfaEnabledAt: true } });
  if (!me) throw new ApiError(401, "Unauthorized");
  if (me.mfaEnabledAt) throw new ApiError(409, "Two-step verification is already on. Turn it off first to set it up again.");

  const secret = generateSecret();
  await db.user.update({ where: { id: user.id }, data: { mfaSecret: encryptSecret(secret), mfaLastStep: null } });
  return NextResponse.json({ secret, otpauthUrl: otpauthUrl(me.email, secret) });
});
