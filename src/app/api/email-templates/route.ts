import { db } from "@/lib/db";
import { ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { createEmailTemplateSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

/** GET /api/email-templates: every template, by name. Anyone signed in can use them. */
export const GET = authed(async () => ok(await db.emailTemplate.findMany({ orderBy: { name: "asc" }, take: 200 })));

/** POST /api/email-templates: create a template (admins). The name must be unique (409 otherwise). */
export const POST = authed(async ({ req, user }) => {
  const body = await readBody(req, createEmailTemplateSchema);
  return ok(await db.emailTemplate.create({ data: { ...body, createdById: user.id } }), 201);
}, "ADMIN");
