import { db } from "@/lib/db";
import { ApiError, ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { notFound, ownerScope, tenantScope } from "@/lib/access";
import { whatsappConfigured } from "@/lib/whatsapp";
import { sendWhatsappTemplateSchema } from "@/lib/validations/crm";
import { sendTemplateMessage } from "@/lib/whatsapp-template-send";

export const dynamic = "force-dynamic";

type P = { id: string };

/**
 * POST /api/contacts/:id/whatsapp/template { templateId, dealId?, values? }: sends an approved, switched-on template
 * to the contact and logs the filled-in text on their timeline (OUT). Unlike a free-text reply it works at any time,
 * including after 24 hours, but only for a contact who has agreed to WhatsApp messages. Anyone who can see the
 * contact may send. A blank that cannot be filled is a 422 naming it; nothing half-filled is sent.
 */
export const POST = authed<P>(async ({ req, user, params }) => {
  const input = await readBody(req, sendWhatsappTemplateSchema);
  const contact = await db.contact.findFirst({
    where: { id: params.id, deletedAt: null, ...ownerScope(user) },
    select: { id: true, firstName: true, lastName: true, phoneE164: true, whatsappOptIn: true },
  });
  if (!contact) throw notFound("Contact");
  if (!(await whatsappConfigured(user.tenantId))) throw new ApiError(409, "WhatsApp is not set up on this CRM yet", "NOT_CONFIGURED");
  if (!contact.phoneE164) throw new ApiError(422, "This contact has no WhatsApp-ready phone number (use the international form, +49…)", "NO_PHONE", { message: ["No valid phone number"] });
  if (!contact.whatsappOptIn) throw new ApiError(422, "This customer has not agreed to WhatsApp messages. Tick it on their contact once they have.", "NOT_OPTED_IN");

  const template = await db.whatsappTemplate.findFirst({ where: { id: input.templateId, ...tenantScope(user), active: true, status: "APPROVED", supported: true } });
  if (!template) throw new ApiError(404, "That template is not available (it must be approved by Meta and switched on).", "NOT_FOUND");

  const activity = await sendTemplateMessage(user, { ...contact, phoneE164: contact.phoneE164 }, template, { dealId: input.dealId, typed: input.values });
  return ok(activity, 201);
});
