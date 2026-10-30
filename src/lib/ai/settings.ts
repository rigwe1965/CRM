import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";

/**
 * A business's Ivy settings, kept in AutomationSetting under the `assistant` key. Off by default, and there is no
 * default spending ceiling: an admin has to choose one before Ivy will run (AI_ASSISTANT_PLAN.md).
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
    /** Whether Ivy may put proposed actions in front of people for approval (Phase 2). Off until an admin allows it; left out means "keep what is stored". */
    proposalsEnabled: z.boolean().optional(),
    /** Whether Ivy may also propose recording payments (Wave B). A separate switch, off until an admin allows it; left out means "keep what is stored". */
    paymentProposalsEnabled: z.boolean().optional(),
    /** Whether Ivy makes a daily "Suggested actions" list for each person (Phase 3b). Off until an admin allows it; left out means "keep what is stored". */
    inboxEnabled: z.boolean().optional(),
    /** Whether Ivy triages incoming WhatsApp messages (Phase 3c). Sends the customer's message text to Anthropic, so it is its own switch, off until an admin allows it; left out means "keep what is stored". */
    triageEnabled: z.boolean().optional(),
    /** The most messages a day the model is called for (Phase 3c); left out means "keep what is stored", and nothing stored means DEFAULT_TRIAGE_DAILY_CAP. */
    triageDailyCap: z.number("Enter a whole number").int("Enter a whole number").min(1, "Must be at least 1").max(1000, "Must be 1,000 or fewer").optional(),
  })
  .refine((v) => !v.enabled || v.monthlyCeilingUsd !== null, { path: ["monthlyCeilingUsd"], message: "Set a monthly ceiling before turning Ivy on" });

export type AssistantSettings = z.infer<typeof assistantSettingsSchema>;

export const DEFAULT_TRIAGE_DAILY_CAP = 100;

export const DEFAULT_ASSISTANT: AssistantSettings = { enabled: false, monthlyCeilingUsd: null };

/** Stored settings that no longer validate fall back to "off", never to something that spends. */
export function resolveAssistant(raw: unknown): AssistantSettings {
  const parsed = assistantSettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_ASSISTANT;
}

export async function loadAssistantSettings(tenantId: string): Promise<AssistantSettings> {
  const row = await db.automationSetting.findUnique({ where: { tenantId_key: { tenantId, key: KEY } } });
  return resolveAssistant(row?.config);
}

export async function saveAssistantSettings(tenantId: string, settings: AssistantSettings, updatedById: string) {
  // A save that leaves a switch out (the limit and on/off buttons do) keeps what is stored.
  const stored = await loadAssistantSettings(tenantId);
  const proposalsEnabled = settings.proposalsEnabled ?? stored.proposalsEnabled;
  const paymentProposalsEnabled = settings.paymentProposalsEnabled ?? stored.paymentProposalsEnabled;
  const inboxEnabled = settings.inboxEnabled ?? stored.inboxEnabled;
  const triageEnabled = settings.triageEnabled ?? stored.triageEnabled;
  const triageDailyCap = settings.triageDailyCap ?? stored.triageDailyCap;
  const config = {
    ...settings,
    ...(proposalsEnabled === undefined ? {} : { proposalsEnabled }),
    ...(paymentProposalsEnabled === undefined ? {} : { paymentProposalsEnabled }),
    ...(inboxEnabled === undefined ? {} : { inboxEnabled }),
    ...(triageEnabled === undefined ? {} : { triageEnabled }),
    ...(triageDailyCap === undefined ? {} : { triageDailyCap }),
  } as unknown as Prisma.InputJsonValue;
  await db.automationSetting.upsert({
    where: { tenantId_key: { tenantId, key: KEY } },
    create: { tenantId, key: KEY, config, updatedById },
    update: { config, updatedById },
  });
  return loadAssistantSettings(tenantId);
}
