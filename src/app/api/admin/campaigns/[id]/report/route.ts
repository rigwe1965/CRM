import { ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { db } from "@/lib/db";
import { notFound } from "@/lib/access";
import { campaignReport } from "@/lib/campaign-report";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/campaigns/:id/report: how a campaign went: sent, delivered, read, failed (with the reasons), skipped,
 * customers who replied within 48 hours and customers who opted out by replying STOP. Delivery and read come from Meta's
 * status updates, so they fill in over the minutes after sending. Admins only.
 */
export const GET = authed<{ id: string }>(async ({ user, params }) => {
  const exists = await db.campaign.findFirst({ where: { id: params.id, tenantId: user.tenantId }, select: { id: true } });
  if (!exists) throw notFound("Campaign");
  return ok(await campaignReport(user.tenantId, exists.id));
}, "ADMIN");
