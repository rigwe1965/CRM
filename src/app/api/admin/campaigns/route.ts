import { db } from "@/lib/db";
import { ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { tenantScope } from "@/lib/access";
import { campaignDto, campaignInclude, checkCampaignTemplate } from "@/lib/campaigns";
import { createCampaignSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

/** GET /api/admin/campaigns: the business's campaigns, newest first, with how many customers have each outcome. Admins only. */
export const GET = authed(async ({ user }) => {
  const rows = await db.campaign.findMany({ where: tenantScope(user), include: campaignInclude, orderBy: { createdAt: "desc" }, take: 100 });
  const counts = rows.length
    ? await db.campaignRecipient.groupBy({ by: ["campaignId", "status"], where: { tenantId: user.tenantId, campaignId: { in: rows.map((r) => r.id) } }, _count: { _all: true } })
    : [];
  return ok(
    rows.map((r) => ({
      ...campaignDto(r),
      counts: Object.fromEntries(counts.filter((c) => c.campaignId === r.id).map((c) => [c.status, c._count._all])),
    })),
  );
}, "ADMIN");

/**
 * POST /api/admin/campaigns { name, templateId, audience?, values? }: saves a draft. Nothing is sent. The template must be
 * approved and switched on, and its blanks only the customer's name or text typed here once for everyone.
 */
export const POST = authed(async ({ req, user }) => {
  const body = await readBody(req, createCampaignSchema);
  const { values } = await checkCampaignTemplate(user.tenantId, body.templateId, body.values);
  const row = await db.campaign.create({
    data: { ...tenantScope(user), name: body.name, templateId: body.templateId, audience: body.audience, values, createdById: user.id },
    include: campaignInclude,
  });
  return ok(campaignDto(row), 201);
}, "ADMIN");
