import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { apiError } from "@/lib/api";
import { requireApiUser } from "@/lib/auth-helpers";
import { encryptSecret, generateSecret, otpauthUrl } from "@/lib/mfa";

export const dynamic = "force-dynamic";

/** POST /api/me/mfa/setup: start enrolment. Stores a pending secret; it only counts once /enable confirms a code. */
export async function POST() {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;
  const me = await db.user.findUnique({ where: { id: guard.user.id }, select: { email: true, mfaEnabledAt: true } });
  if (!me) return apiError("Unauthorized", 401);
  if (me.mfaEnabledAt) return apiError("Two-step verification is already on. Turn it off first to set it up again.", 409);

  const secret = generateSecret();
  await db.user.update({ where: { id: guard.user.id }, data: { mfaSecret: encryptSecret(secret), mfaLastStep: null } });
  return NextResponse.json({ secret, otpauthUrl: otpauthUrl(me.email, secret) });
}
