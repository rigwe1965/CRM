import { db } from "@/lib/db";
import { ApiError, ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { displayName, notFound, ownerScope, tenantScope } from "@/lib/access";
import { contactEmail } from "@/lib/email-templates";
import { sendMail } from "@/lib/mail";
import { senderFor } from "@/lib/sender";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { assertUnderDailyCap } from "@/lib/usage-limits";
import { sendContactEmailSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

/**
 * POST /api/contacts/:id/email: send an email to a contact and log it as an EMAIL activity.
 * Body: { subject, message }. Replies go to the signed-in user (Reply-To), not the shared sender.
 */
export const POST = authed<{ id: string }>(async ({ req, user, params }) => {
  const body = await readBody(req, sendContactEmailSchema);
  await enforceRateLimit(`send-email:${user.id}`, LIMITS.sendEmail);

  const contact = await db.contact.findFirst({
    where: { id: params.id, deletedAt: null, ...ownerScope(user) },
    select: { id: true, email: true, organizationId: true },
  });
  if (!contact) throw notFound("Contact");
  if (!contact.email) {
    throw new ApiError(422, "This contact has no email address", "NO_EMAIL");
  }

  await assertUnderDailyCap(user.tenantId, "emails");
  const senderName = displayName(user);
  try {
    await sendMail({
      to: contact.email,
      subject: body.subject,
      replyTo: user.email ?? undefined,
      from: await senderFor(user.tenantId, `${senderName} via CRM`),
      ...contactEmail(body.message, senderName),
    });
  } catch (e) {
    console.error("contact email failed", e instanceof Error ? e.message : e);
    throw new ApiError(502, "The email could not be sent. Please try again.", "EMAIL_FAILED");
  }

  const activity = await db.activity.create({
    data: {
      ...tenantScope(user),
      type: "EMAIL",
      subject: body.subject,
      body: body.message,
      authorId: user.id,
      contactId: contact.id,
      organizationId: contact.organizationId,
    },
    select: { id: true },
  });
  return ok({ activityId: activity.id, to: contact.email }, 201);
});
