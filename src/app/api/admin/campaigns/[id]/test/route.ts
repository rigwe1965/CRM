import { ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { sendCampaignTest } from "@/lib/campaign-actions";
import { campaignTestSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

/** POST /api/admin/campaigns/:id/test { phone }: sends the draft's template to your own number and marks the draft as tested. Admins only. */
export const POST = authed<{ id: string }>(async ({ req, user, params }) => {
  const { phone } = await readBody(req, campaignTestSchema);
  return ok(await sendCampaignTest(user, params.id, phone));
}, "ADMIN");
