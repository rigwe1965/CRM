import { ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { audit } from "@/lib/audit";
import { importContacts } from "@/lib/contact-import";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { importContactsSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

/**
 * POST /api/contacts/import { type?, rows }: adds up to 500 customers from a spreadsheet the browser has read. Each row is
 * validated on its own; the answer says how many went in and which rows were skipped and why. The importer owns the
 * contacts. No consent is recorded (email and WhatsApp stay off). Any signed-in user, within the plan's contact limit.
 */
export const POST = authed(async ({ req, user }) => {
  const input = await readBody(req, importContactsSchema);
  await enforceRateLimit(`contact-import:${user.id}`, LIMITS.contactImport);
  const outcome = await importContacts(user, input);
  await audit(user, { action: "contacts.imported", entity: "contact", summary: `${outcome.created} imported, ${outcome.skippedCount} skipped`, data: { created: outcome.created, skipped: outcome.skippedCount, type: input.type } }, req);
  return ok(outcome, 201);
});
