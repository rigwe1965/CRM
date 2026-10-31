import { ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { startCampaign } from "@/lib/campaign-actions";
import { startCampaignSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/campaigns/:id/start { expectedCount }: starts a tested draft for the audience you were shown. 409
 * AUDIENCE_CHANGED if that number is no longer right. Messages go out in batches (POST .../step), not in this call. Admins only.
 */
export const POST = authed<{ id: string }>(async ({ req, user, params }) => {
  const { expectedCount } = await readBody(req, startCampaignSchema);
  return ok(await startCampaign(user, params.id, expectedCount), 201);
}, "ADMIN");
