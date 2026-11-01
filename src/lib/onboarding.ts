import { db } from "@/lib/db";
import { whatsappConfigured } from "@/lib/whatsapp";

const KEY = "onboarding";

export type OnboardingStep = { key: "team" | "customers" | "whatsapp" | "order"; label: string; hint: string; href: string; done: boolean };
export type OnboardingView = { dismissed: boolean; allDone: boolean; steps: OnboardingStep[] };

/**
 * The first-run checklist for a business. Whether a step is done is worked out from what the business actually has, so
 * nothing needs to be ticked by hand and it can never fall out of date; only "dismissed" is stored.
 */
export async function onboardingView(tenantId: string): Promise<OnboardingView> {
  const [setting, users, contacts, deals, whatsapp] = await Promise.all([
    db.automationSetting.findUnique({ where: { tenantId_key: { tenantId, key: KEY } } }),
    db.user.count({ where: { tenantId, isActive: true } }),
    db.contact.count({ where: { tenantId, deletedAt: null } }),
    db.deal.count({ where: { tenantId, deletedAt: null } }),
    whatsappConfigured(tenantId),
  ]);
  const steps: OnboardingStep[] = [
    { key: "customers", label: "Add your customers", hint: "Import a spreadsheet, or add them one by one.", href: "/contacts", done: contacts > 0 },
    { key: "order", label: "Create your first order", hint: "Record what a customer bought and how they pay.", href: "/deals", done: deals > 0 },
    { key: "team", label: "Invite a teammate", hint: "Optional. Each person sees their own customers.", href: "/settings", done: users > 1 },
    { key: "whatsapp", label: "Connect WhatsApp", hint: "Optional. Message customers and see their replies here.", href: "/settings", done: whatsapp },
  ];
  return { dismissed: (setting?.config as { dismissed?: boolean } | null)?.dismissed === true, allDone: steps.every((s) => s.done), steps };
}

export async function dismissOnboarding(tenantId: string, userId: string, dismissed: boolean) {
  const config = { dismissed };
  await db.automationSetting.upsert({ where: { tenantId_key: { tenantId, key: KEY } }, create: { tenantId, key: KEY, config, updatedById: userId }, update: { config, updatedById: userId } });
}
