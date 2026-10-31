import { db } from "@/lib/db";
import { ApiError, noContent, ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { notFound, tenantScope } from "@/lib/access";
import { audit } from "@/lib/audit";
import { campaignDto, campaignInclude, checkCampaignTemplate } from "@/lib/campaigns";
import { updateCampaignSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

type P = { id: string };

const find = (id: string, tenantId: string) => db.campaign.findFirst({ where: { id, tenantId }, include: campaignInclude });
const onlyDraft = (status: string) => {
  if (status !== "DRAFT") throw new ApiError(409, "Only a draft campaign can be changed or deleted.", "NOT_A_DRAFT");
};

/** GET /api/admin/campaigns/:id. Admins only. */
export const GET = authed<P>(async ({ user, params }) => {
  const row = await find(params.id, user.tenantId);
  if (!row) throw notFound("Campaign");
  const counts = await db.campaignRecipient.groupBy({ by: ["status"], where: { tenantId: user.tenantId, campaignId: row.id }, _count: { _all: true } });
  return ok({ ...campaignDto(row), counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) });
}, "ADMIN");

/** PATCH /api/admin/campaigns/:id: edits a draft. The template and its typed values are checked again as a pair. */
export const PATCH = authed<P>(async ({ req, user, params }) => {
  const body = await readBody(req, updateCampaignSchema);
  const row = await find(params.id, user.tenantId);
  if (!row) throw notFound("Campaign");
  onlyDraft(row.status);
  const templateId = body.templateId ?? row.templateId;
  const typed = body.values ?? (Array.isArray(row.values) ? (row.values as unknown[]).map(String) : []);
  const { values } = await checkCampaignTemplate(user.tenantId, templateId, typed);
  const updated = await db.campaign.update({
    where: { id: row.id, ...tenantScope(user) },
    // Any edit means what was tested is no longer what would go out.
    data: { name: body.name, templateId, audience: body.audience, values, testedAt: null },
    include: campaignInclude,
  });
  return ok(campaignDto(updated));
}, "ADMIN");

/** DELETE /api/admin/campaigns/:id: deletes a draft for good (its details are kept in the audit log). */
export const DELETE = authed<P>(async ({ req, user, params }) => {
  const row = await find(params.id, user.tenantId);
  if (!row) throw notFound("Campaign");
  onlyDraft(row.status);
  await audit(user, { action: "campaign.deleted", entity: "campaign", entityId: row.id, summary: row.name, data: campaignDto(row) }, req);
  await db.campaign.deleteMany({ where: { id: row.id, status: "DRAFT", ...tenantScope(user) } });
  return noContent();
}, "ADMIN");
