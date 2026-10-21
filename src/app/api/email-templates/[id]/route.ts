import { db } from "@/lib/db";
import { ApiError, noContent, ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { audit } from "@/lib/audit";
import { updateEmailTemplateSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

type P = { id: string };

const missing = () => new ApiError(404, "Template not found", "NOT_FOUND");

/** PATCH /api/email-templates/:id: change the name, subject or message (admins). */
export const PATCH = authed<P>(async ({ req, params }) => {
  const body = await readBody(req, updateEmailTemplateSchema);
  const { count } = await db.emailTemplate.updateMany({ where: { id: params.id }, data: body });
  if (count === 0) throw missing();
  return ok(await db.emailTemplate.findUniqueOrThrow({ where: { id: params.id } }));
}, "ADMIN");

/** DELETE /api/email-templates/:id: permanent delete (admins); the audit log keeps a copy. */
export const DELETE = authed<P>(async ({ req, user, params }) => {
  const snapshot = await db.emailTemplate.findUnique({ where: { id: params.id } });
  if (!snapshot) throw missing();
  await db.emailTemplate.delete({ where: { id: params.id } });
  await audit(user, { action: "email_template.deleted", entity: "emailTemplate", entityId: params.id, summary: snapshot.name, data: snapshot }, req);
  return noContent();
}, "ADMIN");
