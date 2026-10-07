import { db } from "@/lib/db";
import { decryptSecret, hashRecoveryCode, verifyTotp } from "@/lib/mfa";

type MfaUser = { id: string; mfaSecret: string | null; mfaLastStep: number | null; mfaRecoveryCodes: string[] };

/**
 * Checks a 6-digit authenticator code or a recovery code for a user who has two-step verification.
 * A TOTP code is accepted once (its time step is stored atomically); a recovery code is consumed.
 */
export async function verifyMfaCode(user: MfaUser, input: string): Promise<boolean> {
  const code = input.trim();
  if (!user.mfaSecret || !code) return false;

  if (/^\d{3}\s?\d{3}$/.test(code)) {
    const step = verifyTotp(decryptSecret(user.mfaSecret), code, user.mfaLastStep);
    if (step === null) return false;
    const { count } = await db.user.updateMany({
      where: { id: user.id, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }] },
      data: { mfaLastStep: step },
    });
    return count === 1;
  }

  const hash = hashRecoveryCode(code);
  if (!user.mfaRecoveryCodes.includes(hash)) return false;
  const { count } = await db.user.updateMany({
    where: { id: user.id, mfaRecoveryCodes: { has: hash } },
    data: { mfaRecoveryCodes: user.mfaRecoveryCodes.filter((h) => h !== hash) },
  });
  return count === 1;
}
