import { db } from "@/lib/db";

const HOUR_MS = 60 * 60 * 1000;
/** A reply counts as an answer to the campaign if it comes within this long of the message. */
export const REPLY_WINDOW_HOURS = 48;
const chunks = <T>(list: T[], size = 1000) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

export type CampaignReport = {
  /** Customers on the list. */
  total: number;
  /** Messages handed to Meta. */
  sent: number;
  delivered: number;
  read: number;
  /** Refused by us or by Meta when sending. */
  failed: number;
  /** Accepted by Meta but then not delivered. */
  deliveryFailed: number;
  /** Not sent: stopped, withdrew, deleted, lost their number, or replied to opt out. */
  skipped: number;
  /** Still waiting to be sent. */
  waiting: number;
  /** Customers who wrote back within REPLY_WINDOW_HOURS of their message. */
  replies: number;
  /** Customers who replied with a stop word and were opted out. */
  optedOut: number;
  reasons: { kind: "failed" | "skipped" | "not delivered"; reason: string; count: number }[];
};

const top = (kind: CampaignReport["reasons"][number]["kind"], items: (string | null)[]) => {
  const counts = new Map<string, number>();
  for (const r of items) counts.set(r || "No reason given", (counts.get(r || "No reason given") ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([reason, count]) => ({ kind, reason, count }));
};

/**
 * What happened to a campaign, for the business that sent it (the caller is inside `withTenant`). Delivery and read
 * come from Meta's status updates on the messages we sent (the same ones the customer's timeline shows). Money is not
 * involved, so nothing here is summed across currencies.
 */
export async function campaignReport(tenantId: string, campaignId: string): Promise<CampaignReport> {
  const recipients = await db.campaignRecipient.findMany({
    where: { tenantId, campaignId },
    select: { status: true, reason: true, messageId: true, contactId: true, sentAt: true },
    take: 5000,
  });
  const sentOnes = recipients.filter((r) => r.messageId);

  const outgoing: { deliveryStatus: string | null; deliveryError: string | null }[] = [];
  for (const part of chunks(sentOnes.map((r) => r.messageId as string))) {
    outgoing.push(...(await db.activity.findMany({ where: { tenantId, direction: "OUT", externalId: { in: part } }, select: { deliveryStatus: true, deliveryError: true } })));
  }

  // Replies: any customer message from the moment we sent until REPLY_WINDOW_HOURS later.
  const sentAt = new Map(sentOnes.map((r) => [r.contactId, r.sentAt]));
  const earliest = sentOnes.reduce<Date | null>((m, r) => (r.sentAt && (!m || r.sentAt < m) ? r.sentAt : m), null);
  const answered = new Set<string>();
  if (earliest) {
    for (const part of chunks([...sentAt.keys()])) {
      const incoming = await db.activity.findMany({ where: { tenantId, type: "WHATSAPP", direction: "IN", contactId: { in: part }, occurredAt: { gte: earliest } }, select: { contactId: true, occurredAt: true } });
      for (const m of incoming) {
        const sent = m.contactId ? sentAt.get(m.contactId) : null;
        if (m.contactId && sent && m.occurredAt >= sent && m.occurredAt.getTime() <= sent.getTime() + REPLY_WINDOW_HOURS * HOUR_MS) answered.add(m.contactId);
      }
    }
  }

  const failedRows = recipients.filter((r) => r.status === "FAILED");
  const skippedRows = recipients.filter((r) => r.status === "SKIPPED");
  const undelivered = outgoing.filter((o) => o.deliveryStatus === "FAILED");
  return {
    total: recipients.length,
    sent: sentOnes.length,
    delivered: outgoing.filter((o) => o.deliveryStatus === "DELIVERED" || o.deliveryStatus === "READ").length,
    read: outgoing.filter((o) => o.deliveryStatus === "READ").length,
    failed: failedRows.length,
    deliveryFailed: undelivered.length,
    skipped: skippedRows.length,
    waiting: recipients.filter((r) => r.status === "PENDING").length,
    replies: answered.size,
    optedOut: skippedRows.filter((r) => r.reason === "The customer replied to opt out").length,
    reasons: [...top("failed", failedRows.map((r) => r.reason)), ...top("not delivered", undelivered.map((o) => o.deliveryError)), ...top("skipped", skippedRows.map((r) => r.reason))],
  };
}
