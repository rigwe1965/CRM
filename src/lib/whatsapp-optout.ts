import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { optInColumns } from "@/lib/whatsapp-optin";

/**
 * A customer who answers with just one of these words ("STOP", "Unsubscribe.") is opted out at once, without waiting for a
 * person: Meta expects it, and a marketing message after a clear "stop" is how a number gets restricted. Only the whole
 * message counts, so a sentence that merely contains "end" or "cancel" ("please cancel my order") is never taken for it.
 * Longer requests ("please stop messaging me") still become a card for the owner to approve (see ai/triage/rules.ts).
 */
const BARE_STOP = /^[\s"'*]*(stop|unsubscribe|cancel|end)[\s.!"'*]*$/i;

export const isAutoOptOutWord = (text: string) => text.length <= 40 && BARE_STOP.test(text.trim());

/**
 * Withdraws the customer's agreement to WhatsApp messages, drops them from every campaign still waiting to message them,
 * and leaves a note on their timeline and a line in the audit log. Returns false when they had not agreed anyway.
 * Runs as the business (inside `withTenant`).
 */
export async function optOutByReply(tenantId: string, contact: { id: string; whatsappOptIn: boolean }, authorId: string, text: string): Promise<boolean> {
  if (!contact.whatsappOptIn) return false;
  const { count } = await db.contact.updateMany({ where: { id: contact.id, tenantId, whatsappOptIn: true }, data: { whatsappOptIn: false, ...optInColumns(false, true) } });
  if (count === 0) return false;
  await db.campaignRecipient.updateMany({ where: { tenantId, contactId: contact.id, status: "PENDING" }, data: { status: "SKIPPED", reason: "The customer replied to opt out" } });
  await db.activity.create({
    data: { tenantId, type: "NOTE", subject: "Opted out of WhatsApp messages", body: `They replied “${text.trim().slice(0, 40)}”. No more WhatsApp messages will be sent to them.`, authorId, contactId: contact.id },
  });
  await audit({ email: "whatsapp-webhook", tenantId }, { action: "whatsapp.opt_out", entity: "contact", entityId: contact.id, summary: "Replied to opt out" });
  return true;
}
