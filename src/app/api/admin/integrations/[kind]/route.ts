import type { IntegrationKind } from "@prisma/client";
import type { ZodType } from "zod";
import { ApiError, noContent, ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { clearIntegration, SCHEMAS, saveIntegration, type Settings } from "@/lib/integrations";
import { integrationsView } from "@/lib/integrations-view";

export const dynamic = "force-dynamic";

type P = { kind: string };

const KINDS: Record<string, IntegrationKind> = { stripe: "STRIPE", whatsapp: "WHATSAPP", "lead-form": "LEAD_FORM" };
const kindOf = (p: P) => {
  const kind = KINDS[p.kind];
  if (!kind) throw new ApiError(404, "Unknown integration", "NOT_FOUND");
  return kind;
};

/**
 * PUT /api/admin/integrations/:kind (stripe | whatsapp | lead-form): saves the business's settings for that service,
 * encrypted, replacing any earlier ones. The body is the whole set of settings (see `src/lib/integrations.ts`). Returns
 * the same secret-free view as GET.
 */
export const PUT = authed<P>(async ({ req, user, params }) => {
  const kind = kindOf(params);
  const settings = await readBody(req, SCHEMAS[kind] as ZodType<Settings[typeof kind]>);
  await saveIntegration(user.tenantId, kind, settings, user.id);
  return ok(await integrationsView(user.tenantId));
}, "ADMIN");

/** DELETE /api/admin/integrations/:kind: removes the business's saved settings for that service. */
export const DELETE = authed<P>(async ({ user, params }) => {
  await clearIntegration(user.tenantId, kindOf(params));
  return noContent();
}, "ADMIN");
