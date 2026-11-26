import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { isSelectableModel, SELECTABLE_MODEL_IDS, type SelectableModel } from "@/lib/ai/models";

/**
 * A business's AI settings, kept in AutomationSetting under the `assistant` key. Off by default, and there is no
 * default spending ceiling: an admin has to choose one before AI will run (AI_ASSISTANT_PLAN.md).
 */
const KEY = "assistant";

export const assistantSettingsSchema = z
  .object({
    enabled: z.boolean(),
    /** US dollars a month, in cents; null until an admin sets one. */
    monthlyCeilingUsd: z
      .number("Enter an amount in dollars")
      .positive("Must be more than 0")
      .max(10_000, "Must be $10,000 or less")
      .transform((n) => Math.round(n * 100) / 100)
      .nullable(),
    /** Which Claude model AI uses (Settings > AI). Left out means "keep what is stored", and nothing stored means the default model. */
    model: z.enum(SELECTABLE_MODEL_IDS).optional(),
    /** Whether each person may pick their own model for what they ask AI themselves. Off until an admin allows it, because everyone's use comes out of the same spending limit; left out means "keep what is stored". */
    userModelChoice: z.boolean().optional(),
    /** Whether AI may put proposed actions in front of people for approval (Phase 2). Off until an admin allows it; left out means "keep what is stored". */
    proposalsEnabled: z.boolean().optional(),
    /** Whether AI may also propose recording payments (Wave B). A separate switch, off until an admin allows it; left out means "keep what is stored". */
    paymentProposalsEnabled: z.boolean().optional(),
    /** Whether AI makes a daily "Suggested actions" list for each person (Phase 3b). Off until an admin allows it; left out means "keep what is stored". */
    inboxEnabled: z.boolean().optional(),
    /** Whether AI triages incoming WhatsApp messages (Phase 3c). Sends the customer's message text to Anthropic, so it is its own switch, off until an admin allows it; left out means "keep what is stored". */
    triageEnabled: z.boolean().optional(),
    /** The most messages a day the model is called for (Phase 3c); left out means "keep what is stored", and nothing stored means DEFAULT_TRIAGE_DAILY_CAP. */
    triageDailyCap: z.number("Enter a whole number").int("Enter a whole number").min(1, "Must be at least 1").max(1000, "Must be 1,000 or fewer").optional(),
    /** Whether people may have AI read a supplier invoice from a PDF or photo (Phase 4a). The whole document goes to Anthropic, so it is its own switch, off until an admin allows it; left out means "keep what is stored". */
    documentsEnabled: z.boolean().optional(),
    /** The most documents a day (Phase 4); left out means "keep what is stored", and nothing stored means DEFAULT_DOCUMENTS_DAILY_CAP. */
    documentsDailyCap: z.number("Enter a whole number").int("Enter a whole number").min(1, "Must be at least 1").max(500, "Must be 500 or fewer").optional(),
  })
  .refine((v) => !v.enabled || v.monthlyCeilingUsd !== null, { path: ["monthlyCeilingUsd"], message: "Set a monthly ceiling before turning AI on" });

export type AssistantSettings = z.infer<typeof assistantSettingsSchema>;

export const DEFAULT_TRIAGE_DAILY_CAP = 100;
export const DEFAULT_DOCUMENTS_DAILY_CAP = 20;

export const DEFAULT_ASSISTANT: AssistantSettings = { enabled: false, monthlyCeilingUsd: null };

/** Stored settings that no longer validate fall back to "off", never to something that spends. */
export function resolveAssistant(raw: unknown): AssistantSettings {
  // A model that is no longer on the list (retired) means "the default model"; it must not switch AI off.
  const stored = raw && typeof raw === "object" && "model" in raw && !isSelectableModel((raw as { model?: unknown }).model) ? { ...(raw as object), model: undefined } : raw;
  const parsed = assistantSettingsSchema.safeParse(stored);
  return parsed.success ? parsed.data : DEFAULT_ASSISTANT;
}

export async function loadAssistantSettings(tenantId: string): Promise<AssistantSettings> {
  const row = await db.automationSetting.findUnique({ where: { tenantId_key: { tenantId, key: KEY } } });
  return resolveAssistant(row?.config);
}

export async function saveAssistantSettings(tenantId: string, settings: AssistantSettings, updatedById: string) {
  // A save that leaves a switch out (the limit and on/off buttons do) keeps what is stored.
  const stored = await loadAssistantSettings(tenantId);
  const model = settings.model ?? stored.model;
  const userModelChoice = settings.userModelChoice ?? stored.userModelChoice;
  const proposalsEnabled = settings.proposalsEnabled ?? stored.proposalsEnabled;
  const paymentProposalsEnabled = settings.paymentProposalsEnabled ?? stored.paymentProposalsEnabled;
  const inboxEnabled = settings.inboxEnabled ?? stored.inboxEnabled;
  const triageEnabled = settings.triageEnabled ?? stored.triageEnabled;
  const triageDailyCap = settings.triageDailyCap ?? stored.triageDailyCap;
  const documentsEnabled = settings.documentsEnabled ?? stored.documentsEnabled;
  const documentsDailyCap = settings.documentsDailyCap ?? stored.documentsDailyCap;
  const config = {
    ...settings,
    ...(model === undefined ? {} : { model }),
    ...(userModelChoice === undefined ? {} : { userModelChoice }),
    ...(proposalsEnabled === undefined ? {} : { proposalsEnabled }),
    ...(paymentProposalsEnabled === undefined ? {} : { paymentProposalsEnabled }),
    ...(inboxEnabled === undefined ? {} : { inboxEnabled }),
    ...(triageEnabled === undefined ? {} : { triageEnabled }),
    ...(triageDailyCap === undefined ? {} : { triageDailyCap }),
    ...(documentsEnabled === undefined ? {} : { documentsEnabled }),
    ...(documentsDailyCap === undefined ? {} : { documentsDailyCap }),
  } as unknown as Prisma.InputJsonValue;
  await db.automationSetting.upsert({
    where: { tenantId_key: { tenantId, key: KEY } },
    create: { tenantId, key: KEY, config, updatedById },
    update: { config, updatedById },
  });
  return loadAssistantSettings(tenantId);
}

/**
 * A person's own model choice, kept beside the business's settings under a key of their own (AutomationSetting, so no
 * database change). It only counts while the business allows it (`userModelChoice`), and only for what that person asks AI
 * themselves (chat and reading documents). Background work (daily suggestions, WhatsApp help) always uses the business's model.
 */
const userKey = (userId: string) => `assistant-user:${userId}`;

/** The model this person chose, or undefined when they have not, or it has since been retired (then the business's model applies). */
export async function loadUserModel(tenantId: string, userId: string): Promise<SelectableModel | undefined> {
  const row = await db.automationSetting.findUnique({ where: { tenantId_key: { tenantId, key: userKey(userId) } } });
  const model = (row?.config as { model?: unknown } | null)?.model;
  return isSelectableModel(model) ? model : undefined;
}

/** Saves this person's choice; null clears it, so the business's model applies again. */
export async function saveUserModel(tenantId: string, userId: string, model: SelectableModel | null) {
  const key = userKey(userId);
  if (model === null) {
    await db.automationSetting.deleteMany({ where: { tenantId, key } });
    return;
  }
  const config = { model } as unknown as Prisma.InputJsonValue;
  await db.automationSetting.upsert({ where: { tenantId_key: { tenantId, key } }, create: { tenantId, key, config, updatedById: userId }, update: { config, updatedById: userId } });
}

/** The model a call should use: the person's own when the business allows that and they chose one, else the business's (undefined means the default). */
export async function effectiveModel(tenantId: string, userId?: string | null, settings?: AssistantSettings): Promise<SelectableModel | undefined> {
  const s = settings ?? (await loadAssistantSettings(tenantId));
  if (userId && s.userModelChoice === true) {
    const own = await loadUserModel(tenantId, userId);
    if (own) return own;
  }
  return s.model;
}

