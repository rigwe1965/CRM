import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { notFound } from "@/lib/access";
import type { SessionUser } from "@/lib/auth-helpers";
import { audienceFor, readAudience } from "@/lib/campaign-audience";
import { checkCampaignTemplate } from "@/lib/campaigns";
import { normalizePhone } from "@/lib/phone";
import { enforceRateLimit } from "@/lib/rate-limit";
import { assertUnderDailyCap } from "@/lib/usage-limits";
import { sendWhatsAppTemplate, whatsappConfigured } from "@/lib/whatsapp";

const invalid = (field: string, message: string) => new ApiError(422, message, "VALIDATION_ERROR", { [field]: [message] });
const find = (id: string, tenantId: string) => db.campaign.findFirst({ where: { id, tenantId } });

/**
 * Sends the campaign's template to a number the admin types (their own phone), filled in with the admin's name and the
 * typed values, so they see exactly what customers will get. Counts toward the day's WhatsApp limit and is limited to
 * 10 a hour. Marks the draft as tested; any later edit clears that. Not logged on any customer.
 */
export async function sendCampaignTest(user: SessionUser, id: string, phone: string) {
  const campaign = await find(id, user.tenantId);
  if (!campaign) throw notFound("Campaign");
  if (campaign.status !== "DRAFT") throw new ApiError(409, "Only a draft can be tested.", "NOT_A_DRAFT");
  const e164 = normalizePhone(phone);
  if (!e164) throw invalid("phone", "Enter your WhatsApp number in the international form, for example +2348012345678.");
  if (!(await whatsappConfigured(user.tenantId))) throw new ApiError(409, "WhatsApp is not set up on this CRM yet", "NOT_CONFIGURED");
  await enforceRateLimit(`campaign-test:${user.tenantId}`, { max: 10, windowMs: 60 * 60_000 });

  const typed = Array.isArray(campaign.values) ? (campaign.values as unknown[]).map(String) : [];
  const { template, slots } = await checkCampaignTemplate(user.tenantId, campaign.templateId, typed);
  const name = user.name?.trim() || "Test";
  const params = slots.map((s, i) => (s.source === "firstName" ? name.split(" ")[0] : s.source === "fullName" ? name : (typed[i] ?? "")));

  await assertUnderDailyCap(user.tenantId, "whatsapp");
  try {
    await sendWhatsAppTemplate(user.tenantId, e164, template.name, template.language, params);
  } catch (e) {
    throw new ApiError(502, e instanceof Error ? e.message : "WhatsApp did not accept the message", "WHATSAPP_ERROR");
  }
  await db.campaign.updateMany({ where: { id, tenantId: user.tenantId, status: "DRAFT" }, data: { testedAt: new Date() } });
  return { sentTo: e164 };
}

/**
 * Starts a tested draft. The admin must pass the number of customers they were shown (`expectedCount`); if the audience has
 * changed since, nothing starts (409) so they look again. Refused when WhatsApp or the template is not usable, when the
 * audience is empty or over the limit, or when another campaign with the same template is already running. Everyone is
 * put on the list in one go, and each customer can be on a campaign's list only once.
 */
export async function startCampaign(user: SessionUser, id: string, expectedCount: number) {
  const campaign = await find(id, user.tenantId);
  if (!campaign) throw notFound("Campaign");
  if (campaign.status !== "DRAFT") throw new ApiError(409, "This campaign has already been started.", "NOT_A_DRAFT");
  if (!campaign.testedAt) throw new ApiError(422, "Send yourself a test message first, so you see what customers will get.", "NOT_TESTED");
  if (!(await whatsappConfigured(user.tenantId))) throw new ApiError(409, "WhatsApp is not set up on this CRM yet", "NOT_CONFIGURED");
  const typed = Array.isArray(campaign.values) ? (campaign.values as unknown[]).map(String) : [];
  await checkCampaignTemplate(user.tenantId, campaign.templateId, typed);

  const running = await db.campaign.findFirst({ where: { tenantId: user.tenantId, templateId: campaign.templateId, status: { in: ["SENDING", "PAUSED"] } }, select: { name: true } });
  if (running) throw new ApiError(409, `“${running.name}” is already sending this template. Wait for it to finish or stop it first.`, "ALREADY_RUNNING");

  const audience = await audienceFor(user.tenantId, readAudience(campaign.audience), { ids: true });
  if (audience.tooLarge) throw new ApiError(422, `That is more than the ${audience.max} customers one campaign may reach. Narrow the audience.`, "AUDIENCE_TOO_LARGE");
  if (audience.total === 0) throw new ApiError(422, "Nobody matches this audience, so there is nothing to send.", "EMPTY_AUDIENCE");
  if (audience.total !== expectedCount) throw new ApiError(409, `The audience changed: it is now ${audience.total} customers, not ${expectedCount}. Review it and confirm again.`, "AUDIENCE_CHANGED");

  const ids = audience.ids ?? [];
  // Claim the draft first, so a double click cannot start it twice; the list is then filled in.
  const claimed = await db.campaign.updateMany({ where: { id, tenantId: user.tenantId, status: "DRAFT" }, data: { status: "SENDING", startedAt: new Date(), audienceSize: ids.length, pausedReason: null } });
  if (claimed.count === 0) throw new ApiError(409, "This campaign has already been started.", "NOT_A_DRAFT");
  for (let i = 0; i < ids.length; i += 1000) {
    await db.campaignRecipient.createMany({ data: ids.slice(i, i + 1000).map((contactId) => ({ tenantId: user.tenantId, campaignId: id, contactId })), skipDuplicates: true });
  }
  return { audienceSize: ids.length };
}

/** Stops a running or paused campaign for good: nobody still waiting is messaged. Messages already sent stay sent. */
export async function stopCampaign(user: SessionUser, id: string) {
  const campaign = await find(id, user.tenantId);
  if (!campaign) throw notFound("Campaign");
  const stopped = await db.campaign.updateMany({ where: { id, tenantId: user.tenantId, status: { in: ["SENDING", "PAUSED"] } }, data: { status: "STOPPED", finishedAt: new Date(), lockedUntil: null } });
  if (stopped.count === 0) throw new ApiError(409, "Only a running or paused campaign can be stopped.", "NOT_RUNNING");
  const { count } = await db.campaignRecipient.updateMany({ where: { tenantId: user.tenantId, campaignId: id, status: "PENDING" }, data: { status: "SKIPPED", reason: "The campaign was stopped" } });
  return { skipped: count };
}

/** Carries on a paused campaign, after checking again that the template and WhatsApp are usable. */
export async function resumeCampaign(user: SessionUser, id: string) {
  const campaign = await find(id, user.tenantId);
  if (!campaign) throw notFound("Campaign");
  if (campaign.status !== "PAUSED") throw new ApiError(409, "Only a paused campaign can be resumed.", "NOT_PAUSED");
  if (!(await whatsappConfigured(user.tenantId))) throw new ApiError(409, "WhatsApp is not set up on this CRM yet", "NOT_CONFIGURED");
  const typed = Array.isArray(campaign.values) ? (campaign.values as unknown[]).map(String) : [];
  await checkCampaignTemplate(user.tenantId, campaign.templateId, typed);
  await db.campaign.updateMany({ where: { id, tenantId: user.tenantId, status: "PAUSED" }, data: { status: "SENDING", pausedReason: null } });
}
