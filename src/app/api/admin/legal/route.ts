import { ok } from "@/lib/api";
import { audit } from "@/lib/audit";
import { authed } from "@/lib/route";
import { legalStatus, recordAcceptance } from "@/lib/legal-acceptance";
import { LEGAL_VERSION } from "@/lib/legal";

export const dynamic = "force-dynamic";

/** GET /api/admin/legal (admins): whether the business has accepted the current terms, privacy policy and data processing addendum. */
export const GET = authed(async ({ user }) => ok(await legalStatus(user.tenantId)), "ADMIN");

/** POST /api/admin/legal (admins): accepts the current version on behalf of the business. Written to the audit log with the version. */
export const POST = authed(async ({ req, user }) => {
  await recordAcceptance(user.tenantId, user.id);
  await audit(user, { action: "legal.accepted", entity: "tenant", entityId: user.tenantId, summary: `Accepted terms version ${LEGAL_VERSION}`, data: { version: LEGAL_VERSION } }, req);
  return ok(await legalStatus(user.tenantId));
}, "ADMIN");
