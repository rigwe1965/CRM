import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { audit } from "@/lib/audit";
import { generateRecoveryCodes, hashRecoveryCode } from "@/lib/mfa";
import { verifyMfaCode } from "@/lib/mfa-server";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { mfaCodeSchema } from "@/lib/validations/auth";

export const dynamic = "force-dynamic";

/** POST /api/me/mfa/enable { code }: confirms the authenticator works, turns it on and returns the recovery codes once. */
export const POST = authed(async ({ req, user }) => {
  const body = await readBody(req, mfaCodeSchema);
  await enforceRateLimit(`mfa:${user.id}`, LIMITS.mfa);

  const me = await db.user.findUnique({
    where: { id: user.id },
    select: { id: true, mfaSecret: true, mfaLastStep: true, mfaEnabledAt: true },
  });
  if (!me?.mfaSecret) throw new ApiError(400, "Start setup first");
  if (me.mfaEnabledAt) throw new ApiError(409, "Two-step verification is already on");
  // Only an authenticator code counts here (recovery codes don't exist yet).
  const isCode = /^\d{3}\s?\d{3}$/.test(body.code);
  if (!isCode || !(await verifyMfaCode({ ...me, mfaRecoveryCodes: [] }, body.code))) {
    throw new ApiError(400, "That code is not right. Check the app and try again.", "BAD_REQUEST", { code: ["That code is not right"] });
  }

  const recoveryCodes = generateRecoveryCodes();
  await db.user.update({
    where: { id: me.id },
    data: { mfaEnabledAt: new Date(), mfaRecoveryCodes: recoveryCodes.map(hashRecoveryCode) },
  });
  await audit(user, { action: "mfa.enabled", entity: "user", entityId: me.id }, req);
  return NextResponse.json({ recoveryCodes });
});
