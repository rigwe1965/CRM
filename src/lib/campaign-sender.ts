import type { CampaignStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { assertUnderDailyCap } from "@/lib/usage-limits";
import { isWhatsAppRateLimit, sendWhatsAppTemplate, whatsappConfigured } from "@/lib/whatsapp";
import { readSlots, renderBody } from "@/lib/whatsapp-template-slots";

/** Messages one batch tries to send. Small, so a batch always finishes inside one request. */
export const BATCH_SIZE = 25;
/** This many failures in a row in one batch pauses the campaign: something is wrong with the template or the number, not the customer. */
export const MAX_CONSECUTIVE_FAILURES = 5;
/** No other batch may start for this long after one begins; a batch that dies simply lets the lock run out. */
const LOCK_MS = 90_000;

export type PauseReason = "DAILY_LIMIT" | "META_RATE_LIMIT" | "TOO_MANY_FAILURES" | "TEMPLATE_UNAVAILABLE";

export type BatchResult = {
  /** True when another batch was already running; nothing was done. */
  busy: boolean;
  sent: number;
  failed: number;
  skipped: number;
  remaining: number;
  status: CampaignStatus;
  pausedReason: PauseReason | null;
};

const message = (e: unknown) => (e instanceof Error ? e.message : "WhatsApp did not accept the message").slice(0, 300);

/**
 * Sends the next batch of a SENDING campaign, as the business (the caller is inside `withTenant`). Safe to call from
 * several places at once (an admin's open page, the daily job): a lock lets only one batch run, and each customer is
 * claimed before the message is sent, so nobody can get the same campaign twice, even if a batch dies half way. If it
 * dies between claiming and sending, that customer is simply not messaged (shown as sent with no message id).
 *
 * Stops early, and pauses the campaign, when: the plan's daily WhatsApp limit is reached, Meta asks us to slow down, five
 * messages in a row fail, or the template stops being usable. It also checks each customer again just before sending, so
 * someone who withdrew their agreement or was deleted since the start is skipped. Never sends to a STOPPED campaign.
 */
export async function runCampaignBatch(tenantId: string, campaignId: string, opts: { limit?: number; deadline?: number; now?: Date } = {}): Promise<BatchResult> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? BATCH_SIZE;
  const result: BatchResult = { busy: false, sent: 0, failed: 0, skipped: 0, remaining: 0, status: "SENDING", pausedReason: null };

  const claim = await db.campaign.updateMany({
    where: { id: campaignId, tenantId, status: "SENDING", OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { lockedUntil: new Date(now.getTime() + LOCK_MS) },
  });
  const snapshot = async () => {
    const c = await db.campaign.findFirst({ where: { id: campaignId, tenantId }, select: { status: true, pausedReason: true } });
    result.status = c?.status ?? "STOPPED";
    result.pausedReason = (c?.pausedReason as PauseReason | null) ?? null;
    result.remaining = await db.campaignRecipient.count({ where: { tenantId, campaignId, status: "PENDING" } });
    return result;
  };
  if (claim.count === 0) return { ...(await snapshot()), busy: true };

  const pause = (reason: PauseReason) =>
    db.campaign.updateMany({ where: { id: campaignId, tenantId, status: "SENDING" }, data: { status: "PAUSED", pausedReason: reason, lockedUntil: null } });
  const unclaim = (id: string) => db.campaignRecipient.updateMany({ where: { id, tenantId, status: "SENT", messageId: null }, data: { status: "PENDING", sentAt: null } });

  try {
    const campaign = await db.campaign.findFirst({ where: { id: campaignId, tenantId }, include: { template: true } });
    const t = campaign?.template;
    if (!campaign || !t || !t.active || t.status !== "APPROVED" || !t.supported || !(await whatsappConfigured(tenantId))) {
      await pause("TEMPLATE_UNAVAILABLE");
      return await snapshot();
    }
    const slots = readSlots(t.slots, t.body);
    const typed = Array.isArray(campaign.values) ? (campaign.values as unknown[]).map((v) => String(v ?? "")) : [];

    const batch = await db.campaignRecipient.findMany({
      where: { tenantId, campaignId, status: "PENDING" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit,
      include: { contact: { select: { id: true, firstName: true, lastName: true, phoneE164: true, whatsappOptIn: true, deletedAt: true } } },
    });

    let inARow = 0;
    for (const r of batch) {
      if (opts.deadline && Date.now() > opts.deadline) break;
      // Claim first: only one batch can move this customer out of PENDING.
      const mine = await db.campaignRecipient.updateMany({ where: { id: r.id, tenantId, status: "PENDING" }, data: { status: "SENT", sentAt: new Date() } });
      if (mine.count === 0) continue;

      const c = r.contact;
      if (c.deletedAt || !c.whatsappOptIn || !c.phoneE164) {
        await db.campaignRecipient.updateMany({ where: { id: r.id, tenantId }, data: { status: "SKIPPED", sentAt: null, reason: c.deletedAt ? "The contact was deleted" : "No longer agrees to WhatsApp messages or has no WhatsApp-ready number" } });
        result.skipped++;
        continue;
      }

      try {
        await assertUnderDailyCap(tenantId, "whatsapp");
      } catch (e) {
        await unclaim(r.id);
        if (e instanceof ApiError && e.code === "USAGE_LIMIT") {
          await pause("DAILY_LIMIT");
          break;
        }
        throw e;
      }

      const params = slots.map((s, i) => (s.source === "firstName" ? c.firstName : s.source === "fullName" ? `${c.firstName} ${c.lastName === "-" ? "" : c.lastName}`.trim() : (typed[i] ?? "")));
      try {
        const messageId = await sendWhatsAppTemplate(tenantId, c.phoneE164, t.name, t.language, params);
        await db.campaignRecipient.updateMany({ where: { id: r.id, tenantId }, data: { messageId } });
        result.sent++;
        inARow = 0;
        // On the customer's timeline like any template message, which also lets Meta's delivery status reach it.
        await db.activity
          .create({
            data: { tenantId, type: "WHATSAPP", direction: "OUT", subject: `Campaign: ${campaign.name}`, body: renderBody(t.body, params), externalId: messageId, authorId: campaign.createdById, contactId: c.id },
          })
          .catch((e) => console.error("[campaign] timeline entry not saved", r.id, message(e)));
      } catch (e) {
        if (isWhatsAppRateLimit(e)) {
          await unclaim(r.id);
          await pause("META_RATE_LIMIT");
          break;
        }
        await db.campaignRecipient.updateMany({ where: { id: r.id, tenantId }, data: { status: "FAILED", reason: message(e) } });
        result.failed++;
        if (++inARow >= MAX_CONSECUTIVE_FAILURES) {
          await pause("TOO_MANY_FAILURES");
          break;
        }
      }
    }

    // Nobody left to message: done. (A campaign that is still SENDING and has nothing pending has finished.)
    const left = await db.campaignRecipient.count({ where: { tenantId, campaignId, status: "PENDING" } });
    if (left === 0) await db.campaign.updateMany({ where: { id: campaignId, tenantId, status: "SENDING" }, data: { status: "COMPLETED", finishedAt: new Date() } });
    return await snapshot();
  } finally {
    await db.campaign.updateMany({ where: { id: campaignId, tenantId, lockedUntil: { not: null } }, data: { lockedUntil: null } }).catch(() => undefined);
  }
}

/**
 * The daily safety net: for one business, carries on every campaign that is SENDING, and wakes the ones that paused only
 * because the day's limit was used. Works until `deadline` (a time in ms). Returns how many messages went out.
 */
export async function sweepCampaigns(tenantId: string, deadline: number): Promise<{ campaigns: number; sent: number }> {
  await db.campaign.updateMany({ where: { tenantId, status: "PAUSED", pausedReason: "DAILY_LIMIT" }, data: { status: "SENDING", pausedReason: null } });
  const running = await db.campaign.findMany({ where: { tenantId, status: "SENDING" }, select: { id: true }, orderBy: { startedAt: "asc" }, take: 20 });
  let sent = 0;
  for (const { id } of running) {
    while (Date.now() < deadline) {
      const r = await runCampaignBatch(tenantId, id, { deadline });
      sent += r.sent;
      if (r.busy || r.status !== "SENDING" || r.remaining === 0 || r.sent + r.failed + r.skipped === 0) break;
    }
  }
  return { campaigns: running.length, sent };
}
