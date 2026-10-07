import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { apiError, parseBody, toErrorResponse } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth-helpers";
import { generateRecoveryCodes, hashRecoveryCode } from "@/lib/mfa";
import { verifyMfaCode } from "@/lib/mfa-server";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { mfaCodeSchema } from "@/lib/validations/auth";

export const dynamic = "force-dynamic";

/** POST /api/me/mfa/enable { code }: confirms the authenticator works, turns it on and returns the recovery codes once. */
export async function POST(req: Request) {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;
  const body = await parseBody(req, mfaCodeSchema);
  if ("response" in body) return body.response;
  try {
    await enforceRateLimit(`mfa:${guard.user.id}`, LIMITS.mfa);
  } catch (e) {
    return toErrorResponse(e);
  }

  const me = await db.user.findUnique({
    where: { id: guard.user.id },
    select: { id: true, mfaSecret: true, mfaLastStep: true, mfaEnabledAt: true },
  });
  if (!me?.mfaSecret) return apiError("Start setup first", 400);
  if (me.mfaEnabledAt) return apiError("Two-step verification is already on", 409);
  // Only an authenticator code counts here (recovery codes don't exist yet).
  const isCode = /^\d{3}\s?\d{3}$/.test(body.data.code);
  if (!isCode || !(await verifyMfaCode({ ...me, mfaRecoveryCodes: [] }, body.data.code))) {
    return apiError("That code is not right. Check the app and try again.", 400, { code: ["That code is not right"] });
  }

  const recoveryCodes = generateRecoveryCodes();
  await db.user.update({
    where: { id: me.id },
    data: { mfaEnabledAt: new Date(), mfaRecoveryCodes: recoveryCodes.map(hashRecoveryCode) },
  });
  await audit(guard.user, { action: "mfa.enabled", entity: "user", entityId: me.id });
  return NextResponse.json({ recoveryCodes });
}
