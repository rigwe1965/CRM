import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { apiError, parseBody, toErrorResponse } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth-helpers";
import { verifyMfaCode } from "@/lib/mfa-server";
import { verifyPassword } from "@/lib/password";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { mfaDisableSchema } from "@/lib/validations/auth";

export const dynamic = "force-dynamic";

/** POST /api/me/mfa/disable { password, code }: needs both the password and a current code (or a recovery code). */
export async function POST(req: Request) {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;
  const body = await parseBody(req, mfaDisableSchema);
  if ("response" in body) return body.response;
  try {
    await enforceRateLimit(`mfa:${guard.user.id}`, LIMITS.mfa);
  } catch (e) {
    return toErrorResponse(e);
  }

  const me = await db.user.findUnique({
    where: { id: guard.user.id },
    select: { id: true, passwordHash: true, mfaSecret: true, mfaLastStep: true, mfaRecoveryCodes: true, mfaEnabledAt: true },
  });
  if (!me?.mfaEnabledAt) return apiError("Two-step verification is not on", 400);
  const passwordOk = !!me.passwordHash && (await verifyPassword(body.data.password, me.passwordHash));
  if (!passwordOk || !(await verifyMfaCode(me, body.data.code))) {
    return apiError("The password or code is not right", 400);
  }

  await db.user.update({
    where: { id: me.id },
    data: { mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null, mfaRecoveryCodes: [] },
  });
  await audit(guard.user, { action: "mfa.disabled", entity: "user", entityId: me.id });
  return NextResponse.json({ ok: true });
}
