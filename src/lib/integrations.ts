import type { IntegrationKind } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/mfa";
import { DEFAULT_TENANT_ID } from "@/lib/tenant";
import { withTenant } from "@/lib/tenant-context";

/**
 * Each business's own connections to outside services (Phase 3 of MULTI_TENANCY_PLAN.md): its Stripe keys, its
 * WhatsApp number and the websites allowed to post its enquiry form. Stored encrypted, one row per business and
 * kind, with the same key as the two-step secrets (MFA_ENCRYPTION_KEY). The original business keeps working from
 * the environment variables it always used until it saves settings of its own; no other business ever reads them.
 */
export const stripeSettings = z.object({
  secretKey: z.string().trim().regex(/^(sk|rk)_(test|live)_\w+$/, "Must be a Stripe secret or restricted key (sk_… or rk_…)"),
  webhookSecret: z.string().trim().regex(/^whsec_\w+$/, "Must be the webhook signing secret (whsec_…)"),
});
export const whatsappSettings = z.object({
  accessToken: z.string().trim().min(10, "Required"),
  phoneNumberId: z.string().trim().regex(/^\d{5,30}$/, "The number's ID in Meta (digits), not the phone number"),
  appSecret: z.string().trim().min(10, "Required"),
  verifyToken: z.string().trim().min(16, "At least 16 characters"),
});
const origin = z
  .string()
  .trim()
  .transform((v) => v.replace(/\/$/, ""))
  .refine((v) => {
    try {
      const u = new URL(v);
      return (u.protocol === "https:" || u.hostname === "localhost") && u.origin === v;
    } catch {
      return false;
    }
  }, "Must be a website address like https://www.example.com (no path)");
export const leadFormSettings = z.object({ origins: z.array(origin).max(20) });

export const SCHEMAS = { STRIPE: stripeSettings, WHATSAPP: whatsappSettings, LEAD_FORM: leadFormSettings } as const;
export type Settings = { [K in keyof typeof SCHEMAS]: z.infer<(typeof SCHEMAS)[K]> };
export type Source = "settings" | "env";

/** The environment variables that configured the one business before settings existed. */
function fromEnv<K extends IntegrationKind>(kind: K): Settings[K] | null {
  const e = process.env;
  let raw: Settings[K] | null = null;
  if (kind === "STRIPE" && e.STRIPE_SECRET_KEY && e.STRIPE_WEBHOOK_SECRET) raw = { secretKey: e.STRIPE_SECRET_KEY, webhookSecret: e.STRIPE_WEBHOOK_SECRET } as Settings[K];
  if (kind === "WHATSAPP" && e.WHATSAPP_ACCESS_TOKEN && e.WHATSAPP_PHONE_NUMBER_ID && e.WHATSAPP_APP_SECRET && e.WHATSAPP_VERIFY_TOKEN) {
    raw = { accessToken: e.WHATSAPP_ACCESS_TOKEN, phoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID, appSecret: e.WHATSAPP_APP_SECRET, verifyToken: e.WHATSAPP_VERIFY_TOKEN } as Settings[K];
  }
  if (kind === "LEAD_FORM") raw = { origins: (e.LEAD_FORM_ORIGINS ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean) } as Settings[K];
  // Not re-validated: these values worked before settings existed, and a stricter rule must not switch them off.
  return raw;
}

/** A business's settings for one service, or null when it has none. Safe to call outside a request. */
export async function getIntegration<K extends IntegrationKind>(tenantId: string, kind: K): Promise<{ settings: Settings[K]; source: Source } | null> {
  const row = await withTenant(tenantId, () => db.tenantIntegration.findFirst({ where: { tenantId, kind } }));
  if (row) {
    try {
      const sealed = JSON.parse(decryptSecret(row.config)) as { t?: string; k?: string; c?: unknown };
      // The row says whose it is inside the encryption, so a copied or swapped row is refused rather than trusted.
      if (sealed.t !== tenantId || sealed.k !== kind) throw new Error("settings belong to another business or service");
      return { settings: SCHEMAS[kind].parse(sealed.c) as Settings[K], source: "settings" };
    } catch (e) {
      console.error("[integrations] unreadable settings", tenantId, kind, e instanceof Error ? e.message : e);
      return null;
    }
  }
  if (tenantId === DEFAULT_TENANT_ID) {
    const env = fromEnv(kind);
    if (env) return { settings: env, source: "env" };
  }
  return null;
}

export async function saveIntegration<K extends IntegrationKind>(tenantId: string, kind: K, settings: Settings[K], updatedById: string) {
  const config = encryptSecret(JSON.stringify({ t: tenantId, k: kind, c: SCHEMAS[kind].parse(settings) }));
  await withTenant(tenantId, () =>
    db.tenantIntegration.upsert({
      where: { tenantId_kind: { tenantId, kind } },
      create: { tenantId, kind, config, updatedById },
      update: { config, updatedById },
    }),
  );
}

export const clearIntegration = (tenantId: string, kind: IntegrationKind) =>
  withTenant(tenantId, () => db.tenantIntegration.deleteMany({ where: { tenantId, kind } }));
