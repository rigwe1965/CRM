import { ApiError } from "@/lib/api";
import { getIntegration } from "@/lib/integrations";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { AI_RETENTION_DAYS } from "@/lib/ai/retention";
import { IVY_MODEL } from "@/lib/ai/pricing";
import { DEFAULT_DOCUMENTS_DAILY_CAP, DEFAULT_TRIAGE_DAILY_CAP, loadAssistantSettings } from "@/lib/ai/settings";
import { ceilingState, monthToDateByPurpose, monthToDateMicros, nextMonthStart } from "@/lib/ai/usage";
import { usd } from "@/lib/ai/pricing";

/** Everything the admin screen (and the gates below) need to know about Ivy. Never contains the key. */
export async function assistantStatus(tenantId: string, now = new Date()) {
  const [settings, key, spent, byPurpose] = await Promise.all([loadAssistantSettings(tenantId), getIntegration(tenantId, "ANTHROPIC"), monthToDateMicros(tenantId, now), monthToDateByPurpose(tenantId, now)]);
  return {
    model: IVY_MODEL,
    keyConfigured: !!key,
    keySource: key?.source ?? null,
    enabled: settings.enabled,
    proposalsEnabled: settings.proposalsEnabled === true,
    paymentProposalsEnabled: settings.paymentProposalsEnabled === true,
    inboxEnabled: settings.inboxEnabled === true,
    triageEnabled: settings.triageEnabled === true,
    triageDailyCap: settings.triageDailyCap ?? DEFAULT_TRIAGE_DAILY_CAP,
    documentsEnabled: settings.documentsEnabled === true,
    documentsDailyCap: settings.documentsDailyCap ?? DEFAULT_DOCUMENTS_DAILY_CAP,
    /** This month's estimated spend by what it was for. */
    spentByPurposeUsd: { chat: usd(byPurpose.CHAT ?? 0), inbox: usd(byPurpose.INBOX ?? 0), triage: usd(byPurpose.TRIAGE ?? 0), documents: usd(byPurpose.DOCUMENT ?? 0) },
    monthlyCeilingUsd: settings.monthlyCeilingUsd,
    ...ceilingState(settings.monthlyCeilingUsd, spent),
    resetsOn: nextMonthStart(now).toISOString().slice(0, 10),
    retentionDays: AI_RETENTION_DAYS,
  };
}
export type AssistantStatus = Awaited<ReturnType<typeof assistantStatus>>;

/**
 * Gate for a new question to Ivy: switched on, has a key, has a ceiling that is not used up, and the user is not
 * asking too fast. Throws a plain-words ApiError otherwise. Run inside the business's context.
 */
export async function assertCanAsk(user: { id: string; tenantId: string }, now = new Date()) {
  const s = await assistantStatus(user.tenantId, now);
  if (!s.enabled) throw new ApiError(403, "Ivy is switched off for this business. An admin can turn it on in Settings.", "AI_DISABLED");
  if (!s.keyConfigured) throw new ApiError(409, "Ivy has no Anthropic key yet. An admin can add one in Settings.", "AI_NOT_CONFIGURED");
  if (s.level === "unset") throw new ApiError(409, "Ivy has no monthly spending limit yet. An admin can set one in Settings.", "AI_CEILING_UNSET");
  if (s.level === "reached") {
    throw new ApiError(429, `This month's spending limit for Ivy ($${s.ceilingUsd}) has been reached. An admin can raise it in Settings, or Ivy resumes on ${s.resetsOn}.`, "AI_CEILING_REACHED");
  }
  await enforceRateLimit(`ai:ask:${user.id}`, LIMITS.assistant);
  return s;
}

/** Cheap re-check before every model call inside one answer, so a long answer stops at the ceiling instead of overshooting it. */
export async function assertUnderCeiling(tenantId: string, now = new Date()) {
  const settings = await loadAssistantSettings(tenantId);
  const state = ceilingState(settings.monthlyCeilingUsd, await monthToDateMicros(tenantId, now));
  if (state.level === "unset" || state.level === "reached") {
    throw new ApiError(429, "This month's spending limit for Ivy has been reached.", "AI_CEILING_REACHED");
  }
  return state;
}
