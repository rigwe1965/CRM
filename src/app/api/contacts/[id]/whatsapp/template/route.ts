import { db } from "@/lib/db";
import { ApiError, ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { notFound, ownerScope, tenantScope } from "@/lib/access";
import { sendWhatsAppTemplate, whatsappConfigured } from "@/lib/whatsapp";
import { assertUnderDailyCap } from "@/lib/usage-limits";
import { sendWhatsappTemplateSchema } from "@/lib/validations/crm";
import { readSlots, renderBody } from "@/lib/whatsapp-template-slots";
import { resolveSlotValues } from "@/lib/whatsapp-template-send";

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

  const slots = readSlots(template.slots, template.body);
  const values = await resolveSlotValues(user, contact, slots, { dealId: input.dealId, typed: input.values });

  await assertUnderDailyCap(user.tenantId, "whatsapp");
  let messageId: string;
  try {
    messageId = await sendWhatsAppTemplate(user.tenantId, contact.phoneE164, template.name, template.language, values);
  } catch (e) {
    throw new ApiError(502, e instanceof Error ? e.message : "WhatsApp did not accept the message", "WHATSAPP_ERROR");
  }
  const activity = await db.activity.create({
    data: {
      ...tenantScope(user),
      type: "WHATSAPP",
      direction: "OUT",
      subject: `WhatsApp template: ${template.name}`,
      body: renderBody(template.body, values),
      externalId: messageId,
      authorId: user.id,
      contactId: contact.id,
      dealId: input.dealId,
    },
  });
  return ok(activity, 201);
});
