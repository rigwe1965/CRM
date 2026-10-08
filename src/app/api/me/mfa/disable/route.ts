import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { audit } from "@/lib/audit";
import { verifyMfaCode } from "@/lib/mfa-server";
import { verifyPassword } from "@/lib/password";
import { invalidateUserCache } from "@/lib/user-cache";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { mfaDisableSchema } from "@/lib/validations/auth";

export const dynamic = "force-dynamic";

/** POST /api/me/mfa/disable { password, code }: needs both the password and a current code (or a recovery code). */
export const POST = authed(async ({ req, user }) => {
  const body = await readBody(req, mfaDisableSchema);
  await enforceRateLimit(`mfa:${user.id}`, LIMITS.mfa);

  const me = await db.user.findUnique({
    where: { id: user.id },
    select: { id: true, passwordHash: true, mfaSecret: true, mfaLastStep: true, mfaRecoveryCodes: true, mfaEnabledAt: true },
  });
  if (!me?.mfaEnabledAt) throw new ApiError(400, "Two-step verification is not on");
  const passwordOk = !!me.passwordHash && (await verifyPassword(body.password, me.passwordHash));
  if (!passwordOk || !(await verifyMfaCode(me, body.code))) {
    throw new ApiError(400, "The password or code is not right");
  }

  await db.user.update({
    where: { id: me.id },
    data: { mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null, mfaRecoveryCodes: [] },
  });
  invalidateUserCache(me.id);
  await audit(user, { action: "mfa.disabled", entity: "user", entityId: me.id }, req);
  return NextResponse.json({ ok: true });
});
