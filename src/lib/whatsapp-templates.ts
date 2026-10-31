import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { getIntegration } from "@/lib/integrations";
import { defaultSlots, hasContiguousPlaceholders, hasNamedPlaceholders, placeholderNumbers, readSlots } from "@/lib/whatsapp-template-slots";

/** One template as Meta's `message_templates` list returns it (only the fields used here). */
export type MetaTemplate = {
  id?: string;
  name?: string;
  language?: string;
  category?: string;
  status?: string;
  components?: { type?: string; format?: string; text?: string; buttons?: { type?: string; url?: string }[] }[];
};

type Mapped = { name: string; language: string; category: string; status: string; body: string; supported: boolean; metaId: string | null };

/** Turns one of Meta's templates into a row, or null when it has no text body to send. */
export function mapMetaTemplate(t: MetaTemplate): Mapped | null {
  const body = t.components?.find((c) => c.type === "BODY")?.text;
  if (!t.name || !t.language || !body) return null;
  const header = t.components?.find((c) => c.type === "HEADER");
  const buttons = t.components?.find((c) => c.type === "BUTTONS")?.buttons ?? [];
  const supported =
    !hasNamedPlaceholders(body) &&
    hasContiguousPlaceholders(body) &&
    // A media header, or a header with a blank of its own, needs more than the body text this CRM sends.
    (!header || (header.format === "TEXT" && !/\{\{/.test(header.text ?? ""))) &&
    !buttons.some((b) => /\{\{/.test(b.url ?? ""));
  return { name: t.name, language: t.language, category: t.category ?? "UTILITY", status: t.status ?? "PENDING", body, supported, metaId: t.id ?? null };
}

/** Reads every template of the business's WhatsApp Business Account from Meta, following Meta's paging. */
export async function fetchMetaTemplates(accessToken: string, businessAccountId: string): Promise<MetaTemplate[]> {
  const version = process.env.WHATSAPP_API_VERSION || "v23.0";
  let url: string | undefined = `https://graph.facebook.com/${version}/${businessAccountId}/message_templates?fields=id,name,language,category,status,components&limit=100`;
  const out: MetaTemplate[] = [];
  // A business has a few dozen templates at most; the page cap only stops a runaway loop.
  for (let page = 0; url && page < 20; page++) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    const json = (await res.json().catch(() => ({}))) as { data?: MetaTemplate[]; paging?: { next?: string }; error?: { message?: string } };
    if (!res.ok || !Array.isArray(json.data)) throw new ApiError(502, json.error?.message ?? `Meta did not return the templates (${res.status})`, "WHATSAPP_ERROR");
    out.push(...json.data);
    url = json.paging?.next;
  }
  return out;
}

export type SyncResult = { created: number; updated: number; removed: number };

/**
 * Copies the business's templates from Meta. A template already here keeps the admin's slot choices and on/off
 * switch (slots are reset only when the number of blanks changed). One Meta no longer lists is marked REMOVED and
 * switched off, never deleted, so old messages that used it still make sense.
 */
export async function syncWhatsappTemplates(tenantId: string): Promise<SyncResult> {
  const found = await getIntegration(tenantId, "WHATSAPP");
  if (!found) throw new ApiError(409, "WhatsApp is not set up on this CRM yet", "NOT_CONFIGURED");
  const { accessToken, businessAccountId } = found.settings;
  if (!businessAccountId) {
    throw new ApiError(409, "Add the WhatsApp Business Account ID under Settings → Integrations → WhatsApp first. It is how the CRM finds your templates in Meta.", "NO_BUSINESS_ACCOUNT");
  }

  const listed = (await fetchMetaTemplates(accessToken, businessAccountId)).map(mapMetaTemplate).filter((m): m is Mapped => !!m);
  const existing = await db.whatsappTemplate.findMany({ where: { tenantId } });
  const byKey = new Map(existing.map((e) => [`${e.name}\u0000${e.language}`, e]));
  const seen = new Set<string>();
  const now = new Date();
  const result: SyncResult = { created: 0, updated: 0, removed: 0 };

  for (const m of listed) {
    const key = `${m.name}\u0000${m.language}`;
    seen.add(key);
    const row = byKey.get(key);
    if (!row) {
      await db.whatsappTemplate.create({ data: { tenantId, ...m, active: m.status === "APPROVED" && m.supported, slots: defaultSlots(m.body), lastSyncedAt: now } });
      result.created++;
      continue;
    }
    const sameBlanks = placeholderNumbers(row.body).length === placeholderNumbers(m.body).length;
    await db.whatsappTemplate.updateMany({
      where: { id: row.id, tenantId },
      // Meta pausing or rejecting a template switches it off here; coming back to APPROVED leaves the admin to switch it on.
      data: { ...m, active: row.active && m.status === "APPROVED" && m.supported, slots: sameBlanks ? readSlots(row.slots, m.body) : defaultSlots(m.body), lastSyncedAt: now },
    });
    result.updated++;
  }

  for (const row of existing) {
    if (seen.has(`${row.name}\u0000${row.language}`) || row.status === "REMOVED") continue;
    await db.whatsappTemplate.updateMany({ where: { id: row.id, tenantId }, data: { status: "REMOVED", active: false, lastSyncedAt: now } });
    result.removed++;
  }
  return result;
}

/** A row as the screens see it: slots repaired, no internal fields. */
export function templateDto(t: { id: string; name: string; language: string; category: string; body: string; status: string; supported: boolean; active: boolean; slots: unknown; lastSyncedAt: Date }) {
  return {
    id: t.id,
    name: t.name,
    language: t.language,
    category: t.category,
    body: t.body,
    status: t.status,
    supported: t.supported,
    active: t.active,
    slots: readSlots(t.slots, t.body),
    lastSyncedAt: t.lastSyncedAt.toISOString(),
  };
}
