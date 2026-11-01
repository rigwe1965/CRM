import { db } from "@/lib/db";
import { acceptanceConfig, LEGAL_VERSION } from "@/lib/legal";

const KEY = "legal";

export type LegalStatus = { version: string; accepted: boolean; acceptedVersion: string | null; acceptedAt: string | null };

type Stored = { version?: string; acceptedAt?: string; acceptedById?: string | null };

/**
 * Whether the business has accepted the current terms, privacy policy and data processing addendum. The record is one
 * settings row per business, holding the version accepted, when, and by whom; the audit log keeps the history. When
 * LEGAL_VERSION changes, `accepted` turns false and an admin is asked again.
 */
export async function legalStatus(tenantId: string): Promise<LegalStatus> {
  const row = await db.automationSetting.findUnique({ where: { tenantId_key: { tenantId, key: KEY } } });
  const stored = (row?.config ?? null) as Stored | null;
  return { version: LEGAL_VERSION, accepted: stored?.version === LEGAL_VERSION, acceptedVersion: stored?.version ?? null, acceptedAt: stored?.acceptedAt ?? null };
}

export async function recordAcceptance(tenantId: string, userId: string, now = new Date()) {
  const config = acceptanceConfig(userId, now);
  await db.automationSetting.upsert({ where: { tenantId_key: { tenantId, key: KEY } }, create: { tenantId, key: KEY, config, updatedById: userId }, update: { config, updatedById: userId } });
}
