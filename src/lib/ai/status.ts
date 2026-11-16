import { ApiError } from "@/lib/api";
import { getIntegration } from "@/lib/integrations";
import { hasAiKey, includedBalance, platformKey } from "@/lib/ai/included";
import { CREDIT_PACKS } from "@/lib/ai/credit-pack-table";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { AI_RETENTION_DAYS } from "@/lib/ai/retention";
import { MODEL_OPTIONS, resolveModel } from "@/lib/ai/models";
import { DEFAULT_DOCUMENTS_DAILY_CAP, DEFAULT_TRIAGE_DAILY_CAP, effectiveModel, loadAssistantSettings, loadUserModel } from "@/lib/ai/settings";
import { ceilingState, monthToDateByPurpose, monthToDateMicros, nextMonthStart } from "@/lib/ai/usage";
import { usd } from "@/lib/ai/pricing";

/** Everything the admin screen (and the gates below) need to know about AI. Never contains the key. */
export async function assistantStatus(tenantId: string, now = new Date()) {
  const [settings, key, spent, byPurpose, included, usable] = await Promise.all([loadAssistantSettings(tenantId), getIntegration(tenantId, "ANTHROPIC"), monthToDateMicros(tenantId, now), monthToDateByPurpose(tenantId, now), includedBalance(tenantId, now), hasAiKey(tenantId)]);
  return {
    model: resolveModel(settings.model),
    /** The models a business may choose, for the settings screen. */
    modelOptions: MODEL_OPTIONS.map(({ id, label, blurb }) => ({ id, label, blurb })),
    /** Whether each person may choose their own model (Settings > AI). */
    userModelChoice: settings.userModelChoice === true,
    // True with the business's own key, or with included AI that still has something left.
    keyConfigured: usable,
    /** Included AI (INCLUDED_AI_PLAN.md): only meaningful when `eligible`. Dollars, never the platform key. */
    included: { eligible: included.eligible, allowanceUsd: usd(included.allowanceMicros), allowanceUsedUsd: usd(included.allowanceUsedMicros), creditUsd: usd(included.creditMicros), leftUsd: usd(included.leftMicros),
      /** Whether the Buy credit buttons can work: billing is set up and the platform key is on. */
      canBuy: !!process.env.BILLING_STRIPE_SECRET_KEY && !!process.env.BILLING_STRIPE_WEBHOOK_SECRET && platformKey() !== null,
      packs: CREDIT_PACKS.map((p) => ({ id: p.id, priceUsd: p.priceCents / 100, creditUsd: usd(p.creditMicros) })) },
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
 * Gate for a new question to AI: switched on, has a key, has a ceiling that is not used up, and the user is not
 * asking too fast. Throws a plain-words ApiError otherwise. Run inside the business's context.
 */
export async function assertCanAsk(user: { id: string; tenantId: string }, now = new Date()) {
  const s = await assistantStatus(user.tenantId, now);
  if (!s.enabled) throw new ApiError(403, "AI is switched off for this business. An admin can turn it on in Settings.", "AI_DISABLED");
  if (!s.keyConfigured) throw new ApiError(409, "AI has no Anthropic key yet. An admin can add one in Settings.", "AI_NOT_CONFIGURED");
  if (s.level === "unset") throw new ApiError(409, "AI has no monthly spending limit yet. An admin can set one in Settings.", "AI_CEILING_UNSET");
  if (s.level === "reached") {
    throw new ApiError(429, `This month's spending limit for AI ($${s.ceilingUsd}) has been reached. An admin can raise it in Settings, or AI resumes on ${s.resetsOn}.`, "AI_CEILING_REACHED");
  }
  await enforceRateLimit(`ai:ask:${user.id}`, LIMITS.assistant);
  return s;
}

/** Cheap re-check before every model call inside one answer, so a long answer stops at the ceiling instead of overshooting it. */
export async function assertUnderCeiling(tenantId: string, now = new Date(), userId?: string | null) {
  const settings = await loadAssistantSettings(tenantId);
  const state = ceilingState(settings.monthlyCeilingUsd, await monthToDateMicros(tenantId, now));
  if (state.level === "unset" || state.level === "reached") {
    throw new ApiError(429, "This month's spending limit for AI has been reached.", "AI_CEILING_REACHED");
  }
  return { ...state, model: resolveModel(await effectiveModel(tenantId, userId, settings)) };
}

/** What the model picker shows one person: whether they may choose, what they chose, and what applies to them. Holds no spending figures. */
export async function userModelState(tenantId: string, userId: string) {
  const settings = await loadAssistantSettings(tenantId);
  const allowed = settings.userModelChoice === true;
  const own = allowed ? ((await loadUserModel(tenantId, userId)) ?? null) : null;
  return {
    allowed,
    /** What this person has chosen, or null when they follow the business's model. */
    own,
    /** The business's model: what applies to anyone who has not chosen. */
    businessModel: resolveModel(settings.model),
    /** What will actually answer this person's questions. */
    model: resolveModel(own ?? settings.model),
    options: MODEL_OPTIONS.map(({ id, label, blurb }) => ({ id, label, blurb })),
  };
}

