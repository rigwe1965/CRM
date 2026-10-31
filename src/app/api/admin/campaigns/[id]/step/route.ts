import { ApiError, ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { notFound } from "@/lib/access";
import { db } from "@/lib/db";
import { runCampaignBatch } from "@/lib/campaign-sender";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/admin/campaigns/:id/step: sends the next batch (25) of a running campaign and says how it went. The Campaigns
 * page calls this again and again while the campaign runs; the daily job also carries on any that are left. Safe to call
 * at the same time from several places (`busy: true` means another batch was already running). Admins only.
 */
export const POST = authed<{ id: string }>(async ({ user, params }) => {
  const campaign = await db.campaign.findFirst({ where: { id: params.id, tenantId: user.tenantId }, select: { status: true } });
  if (!campaign) throw notFound("Campaign");
  if (campaign.status !== "SENDING") throw new ApiError(409, "This campaign is not sending.", "NOT_RUNNING");
  return ok(await runCampaignBatch(user.tenantId, params.id, { deadline: Date.now() + 40_000 }));
}, "ADMIN");
