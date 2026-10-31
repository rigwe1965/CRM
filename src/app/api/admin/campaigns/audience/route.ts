import { ApiError, ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { audienceFor } from "@/lib/campaign-audience";
import { campaignAudienceSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/campaigns/audience?audience=<JSON filter>: who a filter would reach, before anything is saved or sent.
 * Returns the count, how many matching customers can't be messaged, whether it is over the size limit, and ten names as
 * a sample. Only customers who agreed to WhatsApp and have a WhatsApp-ready number are ever counted. A read, so it is
 * not logged and works even when the workspace is read-only. Admins only.
 */
export const GET = authed(async ({ req, user }) => {
  let raw: unknown = {};
  try {
    raw = JSON.parse(new URL(req.url).searchParams.get("audience") || "{}");
  } catch {
    throw new ApiError(422, "audience must be JSON", "VALIDATION_ERROR", { audience: ["audience must be JSON"] });
  }
  const parsed = campaignAudienceSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError(422, "That filter is not valid", "VALIDATION_ERROR", { audience: parsed.error.issues.map((i) => i.message) });
  return ok(await audienceFor(user.tenantId, parsed.data));
}, "ADMIN");
