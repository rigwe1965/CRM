import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { getIntegration } from "@/lib/integrations";
import { audit } from "@/lib/audit";
import { isAutoOptOutWord, optOutByReply } from "@/lib/whatsapp-optout";
import { trySendMail, appUrl } from "@/lib/mail";
import { resolveLeadOwner } from "@/lib/web-lead";

/** Two-way WhatsApp through Meta's WhatsApp Business Cloud API. A business has it when all four settings are saved. */
export const whatsappConfigured = async (tenantId: string) => !!(await getIntegration(tenantId, "WHATSAPP"));

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

export type DeliveryStatus = "SENT" | "DELIVERED" | "READ" | "FAILED";
export type StatusUpdate = { messageId: string; status: DeliveryStatus; error: string | null };

type StatusPayload = {
  entry?: { changes?: { value?: { statuses?: { id?: string; status?: string; errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[] }[] } }[] }[];
};

const STATUS_NAMES: Record<string, DeliveryStatus> = { sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" };
/** Statuses only move forward: a late "delivered" must not undo "read". FAILED is final unless the message was already delivered. */
const BEHIND: Record<DeliveryStatus, DeliveryStatus[]> = { SENT: [], DELIVERED: ["SENT"], READ: ["SENT", "DELIVERED"], FAILED: ["SENT"] };

/** Pulls the delivery updates for our outgoing messages out of a webhook body (unknown statuses are ignored). */
export function parseStatuses(payload: unknown): StatusUpdate[] {
  const out: StatusUpdate[] = [];
  for (const entry of (payload as StatusPayload)?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const s of change.value?.statuses ?? []) {
        const status = s.status ? STATUS_NAMES[s.status] : undefined;
        if (!s.id || !status) continue;
        const e = s.errors?.[0];
        const reason = e ? [e.title ?? e.message, e.error_data?.details].filter(Boolean).join(": ") : "";
        out.push({ messageId: s.id, status, error: status === "FAILED" ? (reason || "WhatsApp could not deliver the message").slice(0, 500) : null });
      }
    }
  }
  return out;
}

/**
 * Records what Meta says happened to one of our messages. Safe to repeat and to receive out of order (see BEHIND).
 * A message id we do not know (a reminder sent before this existed, another system) is simply ignored.
 */
export async function recordDeliveryStatus(tenantId: string, u: StatusUpdate): Promise<boolean> {
  const { count } = await db.activity.updateMany({
    where: {
      tenantId,
      externalId: u.messageId,
      direction: "OUT",
      OR: [{ deliveryStatus: null }, { deliveryStatus: { in: BEHIND[u.status] } }],
    },
    data: { deliveryStatus: u.status, deliveryError: u.error },
  });
  return count > 0;
}

/**
 * Files one customer message. Safe to call twice for the same message (Meta retries): the message id is unique.
 *  - Known number: a WhatsApp note (IN) on that contact, and a reply task for its owner if none is open.
 *  - Unknown number: a new LEAD (source "WhatsApp") for the default owner, with the same note and task, and an email.
 */
export async function recordInbound(tenantId: string, msg: InboundMessage): Promise<"recorded" | "duplicate"> {
  if (await db.activity.findFirst({ where: { tenantId, externalId: msg.id }, select: { id: true } })) return "duplicate";

  let contact = await db.contact.findFirst({ where: { tenantId, phoneE164: msg.from, deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, ownerId: true, firstName: true, lastName: true, whatsappOptIn: true } });
  const fallbackOwner = contact?.ownerId ? null : await resolveLeadOwner(tenantId);
  const ownerId = contact?.ownerId ?? fallbackOwner?.id;
  if (!ownerId) throw new Error("No active user to receive WhatsApp messages");

  let created = false;
  if (!contact) {
    const [firstName, ...rest] = (msg.name?.replace(/\s+/g, " ").trim() || msg.from).split(" ");
    contact = await db.contact.create({
      data: { tenantId, firstName, lastName: rest.join(" ") || "-", phone: msg.from, phoneE164: msg.from, type: "LEAD", leadStatus: "NEW", source: "WhatsApp", ownerId },
      select: { id: true, ownerId: true, firstName: true, lastName: true, whatsappOptIn: true },
    });
    created = true;
  }

  try {
    await db.activity.create({
      data: { tenantId, type: "WHATSAPP", direction: "IN", subject: "WhatsApp message", body: msg.text, occurredAt: msg.at, externalId: msg.id, authorId: ownerId, contactId: contact.id },
    });
  } catch (e) {
    // Two deliveries at the same instant: the unique id let one through.
    if ((e as { code?: string }).code === "P2002") return "duplicate";
    throw e;
  }

  const label = `${contact.firstName} ${contact.lastName === "-" ? "" : contact.lastName}`.trim();
  // A bare "STOP" opts the customer out at once and needs no reply task. A failure here must not lose the message itself.
  if (isAutoOptOutWord(msg.text)) {
    const optedOut = await optOutByReply(tenantId, contact, ownerId, msg.text).catch((e) => (console.error("[whatsapp] opt-out failed", e instanceof Error ? e.message : e), false));
    if (optedOut) return "recorded";
  }
  const key = `wa-reply:${contact.id}`;
  const open = await db.task.findFirst({ where: { tenantId, automationKey: key, status: { in: ["TODO", "IN_PROGRESS"] } }, select: { id: true } });
  if (!open) {
    await db.task.create({
      data: { tenantId, title: `Reply to WhatsApp from ${label}`, priority: "HIGH", dueDate: new Date(), assigneeId: ownerId, createdById: ownerId, contactId: contact.id, automationKey: key },
    });
  }
  await audit({ email: "whatsapp-webhook", tenantId }, { action: created ? "whatsapp.lead_created" : "whatsapp.received", entity: "contact", entityId: contact.id, summary: label });

  if (created) {
    const owner = fallbackOwner ?? (await resolveLeadOwner(tenantId));
    if (owner) {
      await trySendMail({ to: owner.email, subject: `New WhatsApp lead: ${label}`.slice(0, 150), text: `${label} (${msg.from})\n\n${msg.text}\n\nOpen: ${appUrl()}/contacts/${contact.id}` });
    }
  }
  return "recorded";
}

/** True when the customer wrote to us in the last 24 hours, so a free-text reply is allowed. */
export async function canReplyFreely(tenantId: string, contactId: string, now = new Date()): Promise<boolean> {
  const last = await db.activity.findFirst({
    where: { tenantId, contactId, type: "WHATSAPP", direction: "IN" },
    orderBy: { occurredAt: "desc" },
    select: { occurredAt: true },
  });
  return !!last && now.getTime() - last.occurredAt.getTime() < REPLY_WINDOW_MS;
}

/**
 * Sends an approved message template (the only thing Meta allows outside the 24-hour window). `params` fill
 * {{1}}, {{2}}... in the template body in order. Returns Meta's message id; throws with Meta's reason.
 */
/** A refusal from Meta, with the HTTP status and Meta's error code so callers can tell "slow down" from "this message is wrong". */
export class WhatsAppSendError extends Error {
  constructor(message: string, readonly status: number, readonly code?: number) {
    super(message);
    this.name = "WhatsAppSendError";
  }
}

/** Meta asking us to slow down: HTTP 429, or its throughput / pair-rate / spam-rate error codes. */
export const isWhatsAppRateLimit = (e: unknown) => e instanceof WhatsAppSendError && (e.status === 429 || [4, 80007, 130429, 131048, 131056].includes(e.code ?? -1));

export async function sendWhatsAppTemplate(tenantId: string, toE164: string, name: string, language: string, params: string[]): Promise<string> {
  const found = await getIntegration(tenantId, "WHATSAPP");
  if (!found) throw new Error("WhatsApp is not set up for this business");
  const { accessToken, phoneNumberId } = found.settings;
  const version = process.env.WHATSAPP_API_VERSION || "v23.0";
  // Meta refuses empty parameters, newlines and long runs of spaces inside a parameter.
  const parameters = params.map((p) => ({ type: "text", text: p.replace(/\s+/g, " ").trim().slice(0, 1000) || "-" }));
  const res = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toE164.replace(/\D/g, ""),
      type: "template",
      template: { name, language: { code: language }, components: parameters.length ? [{ type: "body", parameters }] : [] },
    }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: { message?: string; code?: number } };
  const id = json.messages?.[0]?.id;
  if (!res.ok || !id) throw new WhatsAppSendError(json.error?.message ?? `WhatsApp refused the message (${res.status})`, res.status, json.error?.code);
  return id;
}

/** Sends a free-text WhatsApp message. Returns Meta's message id. Throws with Meta's reason when it refuses. */
export async function sendWhatsAppText(tenantId: string, toE164: string, body: string): Promise<string> {
  const found = await getIntegration(tenantId, "WHATSAPP");
  if (!found) throw new Error("WhatsApp is not set up for this business");
  const { accessToken, phoneNumberId } = found.settings;
  const version = process.env.WHATSAPP_API_VERSION || "v23.0";
  const res = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: toE164.replace(/\D/g, ""), type: "text", text: { body, preview_url: false } }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: { message?: string } };
  const id = json.messages?.[0]?.id;
  if (!res.ok || !id) throw new Error(json.error?.message ?? `WhatsApp refused the message (${res.status})`);
  return id;
}
