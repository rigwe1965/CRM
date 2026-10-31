import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { readAudience } from "@/lib/campaign-audience";
import { readSlots, type Slot } from "@/lib/whatsapp-template-slots";

/**
 * Blanks a campaign can fill: the customer's own name, or text typed once for everyone. Anything that depends on one
 * order (amount due, tracking number, order link...) cannot be the same for everyone.
 */
export const CAMPAIGN_SLOT_SOURCES: readonly Slot["source"][] = ["firstName", "fullName", "manual"];

const invalid = (field: string, message: string) => new ApiError(422, message, "VALIDATION_ERROR", { [field]: [message] });

/**
 * Checks that a template can be used for a campaign and that every typed blank has its text. Returns the template and the
 * values lined up with its blanks (empty for blanks the customer's name fills). Throws a 422 naming the field otherwise.
 */
export async function checkCampaignTemplate(tenantId: string, templateId: string, values: string[]) {
  const template = await db.whatsappTemplate.findFirst({ where: { id: templateId, tenantId, active: true, status: "APPROVED", supported: true } });
  if (!template) throw invalid("templateId", "Choose a template that Meta has approved and that is switched on (Settings → Templates).");
  const slots = readSlots(template.slots, template.body);
  const wrong = slots.find((s) => !CAMPAIGN_SLOT_SOURCES.includes(s.source));
  if (wrong) throw invalid("templateId", `“${wrong.label}” fills from an order, which a campaign can't do. Use a template whose blanks are only the customer's name or typed text.`);
  const aligned = slots.map((s, i) => (s.source === "manual" ? (values[i] ?? "").trim() : ""));
  const missing = slots.findIndex((s, i) => s.source === "manual" && aligned[i] === "");
  if (missing >= 0) throw invalid(`values.${missing}`, `Fill in “${slots[missing].label}”.`);
  return { template, slots, values: aligned };
}

type Row = {
  id: string;
  name: string;
  status: string;
  audience: unknown;
  values: unknown;
  templateId: string;
  testedAt: Date | null;
  audienceSize: number | null;
  pausedReason: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  template: { name: string; language: string };
  createdBy: { id: string; name: string };
};

export const campaignDto = (r: Row) => ({
  id: r.id,
  name: r.name,
  status: r.status,
  templateId: r.templateId,
  templateName: r.template.name,
  templateLanguage: r.template.language,
  audience: readAudience(r.audience),
  values: Array.isArray(r.values) ? (r.values as unknown[]).map((v) => String(v)) : [],
  testedAt: r.testedAt,
  audienceSize: r.audienceSize,
  pausedReason: r.pausedReason,
  startedAt: r.startedAt,
  finishedAt: r.finishedAt,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  createdBy: r.createdBy,
});

export const campaignInclude = { template: { select: { name: true, language: true } }, createdBy: { select: { id: true, name: true } } } as const;
