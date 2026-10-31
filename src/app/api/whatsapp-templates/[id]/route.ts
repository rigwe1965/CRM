import { db } from "@/lib/db";
import { ApiError, ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { tenantScope } from "@/lib/access";
import { updateWhatsappTemplateSchema } from "@/lib/validations/crm";
import { placeholderNumbers } from "@/lib/whatsapp-template-slots";
import { templateDto } from "@/lib/whatsapp-templates";

export const dynamic = "force-dynamic";

type P = { id: string };

/**
 * PATCH /api/whatsapp-templates/:id { active?, slots? } (admins): switch a template on or off for the team, or say
 * where each blank's value comes from. The wording, language and approval status belong to Meta and are not editable here.
 */
export const PATCH = authed<P>(async ({ req, user, params }) => {
  const body = await readBody(req, updateWhatsappTemplateSchema);
  const current = await db.whatsappTemplate.findFirst({ where: { id: params.id, ...tenantScope(user) } });
  if (!current) throw new ApiError(404, "Template not found", "NOT_FOUND");
  if (body.slots && body.slots.length !== placeholderNumbers(current.body).length) {
    throw new ApiError(422, `This template has ${placeholderNumbers(current.body).length} blank(s); give one entry for each.`, "VALIDATION_ERROR", { slots: ["Wrong number of entries"] });
  }
  // Only an approved template that this CRM can fill in may be switched on.
  if (body.active && (current.status !== "APPROVED" || !current.supported)) {
    throw new ApiError(409, current.status !== "APPROVED" ? "Meta has not approved this template, so it cannot be switched on yet." : "This template uses features the CRM cannot send yet (media, buttons with variables or named blanks).", "NOT_SENDABLE");
  }
  await db.whatsappTemplate.updateMany({ where: { id: params.id, ...tenantScope(user) }, data: body });
  return ok(templateDto(await db.whatsappTemplate.findFirstOrThrow({ where: { id: params.id, ...tenantScope(user) } })));
}, "ADMIN");
