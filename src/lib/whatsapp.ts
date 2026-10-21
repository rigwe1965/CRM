import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { trySendMail, appUrl } from "@/lib/mail";
import { resolveLeadOwner } from "@/lib/web-lead";

/** Two-way WhatsApp through Meta's WhatsApp Business Cloud API. All four settings must be present. */
export const whatsappConfigured = () =>
  !!(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_APP_SECRET && process.env.WHATSAPP_VERIFY_TOKEN);

/** Meta only lets a business answer with free text within 24 hours of the customer's last message. */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Checks Meta's `X-Hub-Signature-256` header (`sha256=<hmac of the raw body with the app secret>`). */
export function validSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const got = Buffer.from(header.slice(7), "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export type InboundMessage = { id: string; from: string; name: string | null; text: string; at: Date };

type Payload = {
  entry?: {
    changes?: {
      value?: {
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        messages?: {
          id?: string;
          from?: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
          button?: { text?: string };
          interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
          image?: { caption?: string };
          video?: { caption?: string };
          document?: { caption?: string; filename?: string };
        }[];
      };
    }[];
  }[];
};

/** Pulls the customer messages out of a webhook body (status updates and anything unrecognised are ignored). */
export function parseInbound(payload: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  for (const entry of (payload as Payload)?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const names = new Map((change.value?.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of change.value?.messages ?? []) {
        if (!m.id || !m.from) continue;
        const caption = m.image?.caption ?? m.video?.caption ?? m.document?.caption;
        const text =
          m.text?.body ??
          m.button?.text ??
          m.interactive?.button_reply?.title ??
          m.interactive?.list_reply?.title ??
          (m.type && m.type !== "text" ? `[${m.type}]${caption ? ` ${caption}` : ""}` : "[message]");
        const seconds = Number(m.timestamp);
        out.push({ id: m.id, from: `+${m.from.replace(/\D/g, "")}`, name: names.get(m.from) ?? null, text: text.slice(0, 4000), at: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date() });
      }
    }
  }
  return out;
}

/**
 * Files one customer message. Safe to call twice for the same message (Meta retries): the message id is unique.
 *  - Known number: a WhatsApp note (IN) on that contact, and a reply task for its owner if none is open.
 *  - Unknown number: a new LEAD (source "WhatsApp") for the default owner, with the same note and task, and an email.
 */
export async function recordInbound(msg: InboundMessage): Promise<"recorded" | "duplicate"> {
  if (await db.activity.findUnique({ where: { externalId: msg.id }, select: { id: true } })) return "duplicate";

  let contact = await db.contact.findFirst({ where: { phoneE164: msg.from, deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, ownerId: true, firstName: true, lastName: true } });
  const fallbackOwner = contact?.ownerId ? null : await resolveLeadOwner();
  const ownerId = contact?.ownerId ?? fallbackOwner?.id;
  if (!ownerId) throw new Error("No active user to receive WhatsApp messages");

  let created = false;
  if (!contact) {
    const [firstName, ...rest] = (msg.name?.replace(/\s+/g, " ").trim() || msg.from).split(" ");
    contact = await db.contact.create({
      data: { firstName, lastName: rest.join(" ") || "-", phone: msg.from, phoneE164: msg.from, type: "LEAD", leadStatus: "NEW", source: "WhatsApp", ownerId },
      select: { id: true, ownerId: true, firstName: true, lastName: true },
    });
    created = true;
  }

  try {
    await db.activity.create({
      data: { type: "WHATSAPP", direction: "IN", subject: "WhatsApp message", body: msg.text, occurredAt: msg.at, externalId: msg.id, authorId: ownerId, contactId: contact.id },
    });
  } catch (e) {
    // Two deliveries at the same instant: the unique id let one through.
    if ((e as { code?: string }).code === "P2002") return "duplicate";
    throw e;
  }

  const label = `${contact.firstName} ${contact.lastName === "-" ? "" : contact.lastName}`.trim();
  const key = `wa-reply:${contact.id}`;
  const open = await db.task.findFirst({ where: { automationKey: key, status: { in: ["TODO", "IN_PROGRESS"] } }, select: { id: true } });
  if (!open) {
    await db.task.create({
      data: { title: `Reply to WhatsApp from ${label}`, priority: "HIGH", dueDate: new Date(), assigneeId: ownerId, createdById: ownerId, contactId: contact.id, automationKey: key },
    });
  }
  await audit({ email: "whatsapp-webhook" }, { action: created ? "whatsapp.lead_created" : "whatsapp.received", entity: "contact", entityId: contact.id, summary: label });

  if (created) {
    const owner = fallbackOwner ?? (await resolveLeadOwner());
    if (owner) {
      await trySendMail({ to: owner.email, subject: `New WhatsApp lead: ${label}`.slice(0, 150), text: `${label} (${msg.from})\n\n${msg.text}\n\nOpen: ${appUrl()}/contacts/${contact.id}` });
    }
  }
  return "recorded";
}

/** True when the customer wrote to us in the last 24 hours, so a free-text reply is allowed. */
export async function canReplyFreely(contactId: string, now = new Date()): Promise<boolean> {
  const last = await db.activity.findFirst({
    where: { contactId, type: "WHATSAPP", direction: "IN" },
    orderBy: { occurredAt: "desc" },
    select: { occurredAt: true },
  });
  return !!last && now.getTime() - last.occurredAt.getTime() < REPLY_WINDOW_MS;
}

/** Sends a free-text WhatsApp message. Returns Meta's message id. Throws with Meta's reason when it refuses. */
export async function sendWhatsAppText(toE164: string, body: string): Promise<string> {
  const version = process.env.WHATSAPP_API_VERSION || "v23.0";
  const res = await fetch(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: toE164.replace(/\D/g, ""), type: "text", text: { body, preview_url: false } }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: { message?: string } };
  const id = json.messages?.[0]?.id;
  if (!res.ok || !id) throw new Error(json.error?.message ?? `WhatsApp refused the message (${res.status})`);
  return id;
}
