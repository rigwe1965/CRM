import { platformDb } from "@/lib/platform-db";
import { ApiError } from "@/lib/api";
import { decryptSecretInfo, encryptSecret, recoveryCodeHashes, verifyTotp } from "@/lib/mfa";

type MfaUser = { id: string; mfaSecret: string | null; mfaLastStep: number | null; mfaRecoveryCodes: string[] };

/**
 * Checks a 6-digit authenticator code or a recovery code for a user who has two-step verification.
 * A TOTP code is accepted once (its time step is stored atomically); a recovery code is consumed.
 */
export async function verifyMfaCode(user: MfaUser, input: string): Promise<boolean> {
  const code = input.trim();
  if (!user.mfaSecret || !code) return false;

  if (/^\d{3}\s?\d{3}$/.test(code)) {
    const { plain, current } = decryptSecretInfo(user.mfaSecret);
    const step = verifyTotp(plain, code, user.mfaLastStep);
    if (step === null) return false;
    const { count } = await platformDb.user.updateMany({
      where: { id: user.id, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }] },
      // A secret still stored under an old key is re-encrypted with the current one.
      data: { mfaLastStep: step, ...(current ? {} : { mfaSecret: encryptSecret(plain) }) },
    });
    return count === 1;
  }

  const hash = recoveryCodeHashes(code).find((h) => user.mfaRecoveryCodes.includes(h));
  if (!hash) return false;
  const { count } = await platformDb.user.updateMany({
    where: { id: user.id, mfaRecoveryCodes: { has: hash } },
    data: { mfaRecoveryCodes: user.mfaRecoveryCodes.filter((h) => h !== hash) },
  });
  return count === 1;
}

/** Same step-up for callers that only have the session user: looks up the MFA fields first. */
export async function stepUpForUser(userId: string, code: string | undefined) {
  const user = await platformDb.user.findUnique({
    where: { id: userId },
    select: { id: true, mfaSecret: true, mfaLastStep: true, mfaRecoveryCodes: true, mfaEnabledAt: true },
  });
  if (!user) throw new ApiError(401, "Unauthorized");
  await requireMfaStepUp(user, code);
}

/**
 * Step-up for sensitive actions: accounts with two-step verification must also give a current code.
 * Does nothing for accounts without it.
 */
export async function requireMfaStepUp(user: MfaUser & { mfaEnabledAt: Date | null }, code: string | undefined) {
  if (!user.mfaEnabledAt) return;
  if (!code?.trim()) {
    throw new ApiError(422, "Enter the code from your authenticator app", "VALIDATION_ERROR", { code: ["Enter the code from your authenticator app"] });
  }
  if (!(await verifyMfaCode(user, code))) {
    throw new ApiError(400, "That code is not right", "BAD_REQUEST", { code: ["That code is not right"] });
  }
}
