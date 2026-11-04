import { ApiError, ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { getIntegration } from "@/lib/integrations";
import { assistantSettingsSchema, saveAssistantSettings } from "@/lib/ai/settings";
import { assistantStatus } from "@/lib/ai/status";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/assistant: whether AI has a key, is switched on, its monthly spending ceiling, this month's estimated
 * spend and where it stands against the ceiling. Never contains the key. Admins only.
 */
export const GET = authed(async ({ user }) => ok(await assistantStatus(user.tenantId)), "ADMIN");

/**
 * PUT /api/admin/assistant { enabled, monthlyCeilingUsd }: switches AI on or off and sets the monthly ceiling in US
 * dollars. AI can't be switched on without a ceiling (the schema refuses) or without a saved Anthropic key. The key
 * itself is saved through PUT /api/admin/integrations/anthropic.
 */
export const PUT = authed(async ({ req, user }) => {
  const body = await readBody(req, assistantSettingsSchema);
  if (body.enabled && !(await getIntegration(user.tenantId, "ANTHROPIC"))) {
    throw new ApiError(409, "Add your Anthropic key before switching AI on.", "AI_NOT_CONFIGURED");
  }
  await saveAssistantSettings(user.tenantId, body, user.id);
  return ok(await assistantStatus(user.tenantId));
}, "ADMIN");
