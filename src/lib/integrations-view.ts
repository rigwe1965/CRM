import { getIntegration } from "@/lib/integrations";
import { appUrl } from "@/lib/mail";

/** What the admin screen may know about the business's integrations: never a secret. */
export async function integrationsView(tenantId: string) {
  const base = appUrl().replace(/\/$/, "");
  // The original business keeps its original addresses; every other uses its own.
  const [stripe, whatsapp, leadForm] = await Promise.all([getIntegration(tenantId, "STRIPE"), getIntegration(tenantId, "WHATSAPP"), getIntegration(tenantId, "LEAD_FORM")]);
  return {
    stripe: { configured: !!stripe, source: stripe?.source ?? null, webhookUrl: `${base}/api/webhooks/stripe/${tenantId}` },
    whatsapp: {
      configured: !!whatsapp,
      source: whatsapp?.source ?? null,
      phoneNumberId: whatsapp?.settings.phoneNumberId ?? null,
      webhookUrl: `${base}/api/webhooks/whatsapp/${tenantId}`,
    },
    leadForm: { configured: !!leadForm?.settings.origins.length, source: leadForm?.source ?? null, origins: leadForm?.settings.origins ?? [], formUrl: `${base}/api/public/lead/${tenantId}` },
  };
}
