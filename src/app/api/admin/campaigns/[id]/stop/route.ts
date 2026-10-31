import { ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { stopCampaign } from "@/lib/campaign-actions";

export const dynamic = "force-dynamic";

/** POST /api/admin/campaigns/:id/stop: stops a running or paused campaign for good. Messages already sent stay sent. Admins only. */
export const POST = authed<{ id: string }>(async ({ user, params }) => ok(await stopCampaign(user, params.id)), "ADMIN");
