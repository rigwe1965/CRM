import { ok, readQuery } from "@/lib/api";
import { authed } from "@/lib/route";
import { ownerScope } from "@/lib/access";
import { findDuplicates } from "@/lib/duplicates";
import { duplicateQuery } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

/** GET /api/contacts/duplicates?firstName&lastName&phone&email&excludeId: contacts that look like this one (warning only, nothing is blocked). */
export const GET = authed(async ({ req, user }) => {
  const q = readQuery(req, duplicateQuery);
  return ok(await findDuplicates(ownerScope(user), q));
});
