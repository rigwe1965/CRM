import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { billingConfigured, billingStripe } from "@/lib/billing";
import { verifyStepUp } from "@/lib/export/run";
import { trySendMail } from "@/lib/mail";
import { deletionScheduledEmail } from "@/lib/email-templates";
import { platformDb } from "@/lib/platform-db";
import type { SessionUser } from "@/lib/auth-helpers";

/**
 * Deleting a whole business (Phase 5 of MULTI_TENANCY_PLAN.md). An admin asks; the business turns read-only (it can
 * still export, and can change its mind) and everything is erased for good once the grace period has passed.
 * What stays: the Stripe customer and its invoices (they are our tax records, and live in Stripe, not here), and one
 * platform audit line saying a business was erased (no personal data).
 */
export const DELETION_GRACE_DAYS = 30;
const DAY_MS = 86_400_000;

export const deletionDate = (requestedAt: Date) => new Date(requestedAt.getTime() + DELETION_GRACE_DAYS * DAY_MS);

export async function deletionStatus(tenantId: string) {
  const t = await platformDb.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { deletionRequestedAt: true } });
  return { requestedAt: t.deletionRequestedAt, erasedOn: t.deletionRequestedAt ? deletionDate(t.deletionRequestedAt) : null, graceDays: DELETION_GRACE_DAYS };
}

/** Starts the countdown. The admin must retype the business name and, with two-step verification on, give a fresh code. */
export async function requestDeletion(user: SessionUser, input: { confirmName: string; code?: string }, req: Request) {
  const t = await platformDb.tenant.findUniqueOrThrow({ where: { id: user.tenantId }, select: { name: true, plan: true, deletionRequestedAt: true } });
  if (t.plan === "internal") throw new ApiError(403, "This business can only be deleted by the platform operator.", "NOT_ALLOWED");
  if (t.deletionRequestedAt) throw new ApiError(409, "Deletion has already been requested.", "ALREADY_REQUESTED");
  if (input.confirmName.trim() !== t.name) throw new ApiError(422, "Type the business name exactly to confirm.", "CONFIRM_NAME");
  await verifyStepUp(user, input.code);

  const requestedAt = new Date();
  await platformDb.tenant.update({ where: { id: user.tenantId }, data: { deletionRequestedAt: requestedAt } });
  await audit(user, { action: "tenant.deletion.requested", entity: "tenant", entityId: user.tenantId, summary: `Erasure on ${deletionDate(requestedAt).toISOString().slice(0, 10)}` }, req);
  if (user.email) await trySendMail({ to: user.email, ...deletionScheduledEmail(t.name, deletionDate(requestedAt)) });
  return deletionStatus(user.tenantId);
}

export async function cancelDeletion(user: SessionUser, req: Request) {
  const { count } = await platformDb.tenant.updateMany({ where: { id: user.tenantId, deletionRequestedAt: { not: null } }, data: { deletionRequestedAt: null } });
  if (!count) throw new ApiError(409, "Deletion has not been requested.", "NOT_REQUESTED");
  await audit(user, { action: "tenant.deletion.canceled", entity: "tenant", entityId: user.tenantId }, req);
  return deletionStatus(user.tenantId);
}

/**
 * Erases one business: every row in every business table, its users, and the business itself, in one transaction so
 * it is all or nothing. Children come before the rows they point at. A test checks this list covers every table.
 */
export const ERASE_ORDER = [
  "campaignRecipient", "campaign", "instalmentReminder", "instalment", "payment", "paymentLink", "invoiceItem", "invoice", "dealItem", "stockAdjustment", "stockThreshold",
  "activity", "task", "contactTag", "tag", "savedFilter", "deal", "contact", "organization", "emailTemplate", "whatsappTemplate", "customerOrderLink",
  "automationSetting", "tenantIntegration", "auditLog", "aiMessage", "aiProposal", "aiConversation", "aiUsage", "aiInboxRun", "aiTriage", "knowledgeEntryVersion", "knowledgeEntry", "user",
] as const;

export async function eraseTenant(tenantId: string) {
  const t = await platformDb.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, slug: true, stripeSubscriptionId: true, plan: true } });
  if (t.plan === "internal") throw new Error("refusing to erase the internal business");
  // Stop charging first; if Stripe can't be reached the erasure is retried tomorrow rather than leaving a live subscription.
  if (t.stripeSubscriptionId && billingConfigured()) {
    await billingStripe().subscriptions.cancel(t.stripeSubscriptionId).catch((e: { code?: string }) => {
      if (e?.code !== "resource_missing") throw e;
    });
  }
  const emails = (await platformDb.user.findMany({ where: { tenantId }, select: { email: true } })).map((u) => u.email);
  await platformDb.$transaction(
    async (db) => {
      // The audit log refuses deletes except for the business named here, for this transaction only (see the migration).
      await db.$executeRaw`SELECT set_config('app.erasing_tenant', ${tenantId}, true)`;
      const tables = db as unknown as Record<string, { deleteMany(a: { where: Record<string, unknown> }): Promise<unknown> }>;
      for (const m of ERASE_ORDER) await tables[m].deleteMany({ where: { tenantId } });
      // Reset, invite and signup tokens are keyed by a prefix plus the email.
      await db.verificationToken.deleteMany({ where: { OR: emails.map((e) => ({ identifier: { endsWith: e } })) } });
      await db.tenant.deleteMany({ where: { id: tenantId } });
    },
    { timeout: 120_000 },
  );
  await audit(null, { action: "tenant.erased", entity: "tenant", entityId: tenantId, summary: `${t.name} (${t.slug})` });
}

/** Daily: erases every business whose grace period is over. One failing business doesn't stop the others. */
export async function purgeDeletedTenants(now = new Date()): Promise<{ erased: number; failed: number }> {
  const due = await platformDb.tenant.findMany({ where: { deletionRequestedAt: { lt: new Date(now.getTime() - DELETION_GRACE_DAYS * DAY_MS) } }, select: { id: true } });
  let erased = 0;
  let failed = 0;
  for (const { id } of due) {
    try {
      await eraseTenant(id);
      erased++;
    } catch (e) {
      failed++;
      console.error("[tenant] erasure failed", id, e instanceof Error ? e.message : e);
    }
  }
  return { erased, failed };
}
