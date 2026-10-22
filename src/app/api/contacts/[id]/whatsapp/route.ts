import { db } from "@/lib/db";
import { ApiError, ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { notFound, ownerScope, tenantScope } from "@/lib/access";
import { canReplyFreely, sendWhatsAppText, whatsappConfigured } from "@/lib/whatsapp";
import { sendWhatsappSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

type P = { id: string };

const find = (id: string, user: Parameters<typeof ownerScope>[0]) =>
  db.contact.findFirst({ where: { id, deletedAt: null, ...ownerScope(user) }, select: { id: true, phoneE164: true } });

/** GET /api/contacts/:id/whatsapp: can this contact be answered from inside the CRM right now? */
export const GET = authed<P>(async ({ user, params }) => {
  const contact = await find(params.id, user);
  if (!contact) throw notFound("Contact");
  const configured = await whatsappConfigured(user.tenantId);
  return ok({ configured, canSend: configured && !!contact.phoneE164 && (await canReplyFreely(user.tenantId, contact.id)) });
});

/**
 * POST /api/contacts/:id/whatsapp { message }: sends a WhatsApp message from the CRM and logs it (OUT).
 * Free text is only allowed within 24 hours of the customer's last message (Meta's rule); outside that, Meta
 * requires an approved template, which this does not send. 409 explains it rather than letting Meta refuse.
 */
export const POST = authed<P>(async ({ req, user, params }) => {
  const { message } = await readBody(req, sendWhatsappSchema);
  const contact = await find(params.id, user);
  if (!contact) throw notFound("Contact");
  if (!(await whatsappConfigured(user.tenantId))) throw new ApiError(409, "WhatsApp is not set up on this CRM yet", "NOT_CONFIGURED");
  if (!contact.phoneE164) throw new ApiError(422, "This contact has no WhatsApp-ready phone number (use the international form, +49…)", "VALIDATION_ERROR", { message: ["No valid phone number"] });
  if (!(await canReplyFreely(user.tenantId, contact.id))) {
    throw new ApiError(409, "WhatsApp only allows free-text replies within 24 hours of the customer's last message. Wait for them to write, or use an approved template.", "OUTSIDE_WINDOW");
  }
  let id: string;
  try {
    id = await sendWhatsAppText(user.tenantId, contact.phoneE164, message);
  } catch (e) {
    throw new ApiError(502, e instanceof Error ? e.message : "WhatsApp did not accept the message", "WHATSAPP_ERROR");
  }
  const activity = await db.activity.create({
    data: { ...tenantScope(user), type: "WHATSAPP", direction: "OUT", subject: "WhatsApp message", body: message, externalId: id, authorId: user.id, contactId: contact.id },
  });
  return ok(activity, 201);
});
