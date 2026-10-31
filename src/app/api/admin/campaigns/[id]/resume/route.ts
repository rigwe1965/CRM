import { ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { resumeCampaign } from "@/lib/campaign-actions";

export const dynamic = "force-dynamic";

/** POST /api/admin/campaigns/:id/resume: carries on a paused campaign. Admins only. */
export const POST = authed<{ id: string }>(async ({ user, params }) => {
  await resumeCampaign(user, params.id);
  return ok({ resumed: true });
}, "ADMIN");
