import { db } from "@/lib/db";

/** Conversations with Ivy are deleted this many days after their last message (their messages go with them). */
export const AI_RETENTION_DAYS = 90;
const DAY_MS = 86_400_000;

/**
 * Deletes one business's conversations that have been quiet for the retention period. Spend records (AiUsage) are
 * kept: they hold token counts only, no conversation text, and the ceiling needs this month's. Run inside the
 * business's context; the daily job loops over businesses (src/lib/automations/index.ts).
 */
export async function purgeOldConversations(tenantId: string, now = new Date()) {
  const cutoff = new Date(now.getTime() - AI_RETENTION_DAYS * DAY_MS);
  // Proposals whose time ran out are closed first; the rest go with their conversation.
  await db.aiProposal.updateMany({ where: { tenantId, status: "PENDING", expiresAt: { lt: now } }, data: { status: "EXPIRED", decidedAt: now } });
  const { count } = await db.aiConversation.deleteMany({ where: { tenantId, updatedAt: { lt: cutoff } } });
  // Suggestions Ivy made on her own belong to no conversation, so they go on their own clock, once decided or expired; so do the daily run records.
  await db.aiProposal.deleteMany({ where: { tenantId, conversationId: null, status: { not: "PENDING" }, createdAt: { lt: cutoff } } });
  await db.aiInboxRun.deleteMany({ where: { tenantId, startedAt: { lt: cutoff } } });
  await db.aiTriage.deleteMany({ where: { tenantId, createdAt: { lt: cutoff } } });
  return count;
}
