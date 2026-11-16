import { ApiError, ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { hasAiKey, notConfiguredError, resolveAiKey } from "@/lib/ai/included";
import { assistantSettingsSchema, saveAssistantSettings } from "@/lib/ai/settings";
import { assistantStatus } from "@/lib/ai/status";
import { verifyApiKey } from "@/lib/ai/client";
import { loadAssistantSettings } from "@/lib/ai/settings";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/assistant: whether AI has a key, is switched on, its monthly spending ceiling, this month's estimated
 * spend and where it stands against the ceiling. Never contains the key. Admins only.
 */
export const GET = authed(async ({ user }) => ok(await assistantStatus(user.tenantId)), "ADMIN");

/**
 * PUT /api/admin/assistant { enabled, monthlyCeilingUsd, model? }: switches AI on or off and sets the monthly ceiling in US
 * dollars. AI can't be switched on without a ceiling (the schema refuses) or without a saved Anthropic key. The key
 * itself is saved through PUT /api/admin/integrations/anthropic.
 */
export const PUT = authed(async ({ req, user }) => {
  const body = await readBody(req, assistantSettingsSchema);
  if (body.enabled && !(await hasAiKey(user.tenantId))) {
    throw new ApiError(409, "Add your Anthropic key before switching AI on.", "AI_NOT_CONFIGURED");
  }
  // A different model is only saved once the business's own key is shown to be allowed to use it, so a choice can never leave AI broken.
  if (body.model && body.model !== (await loadAssistantSettings(user.tenantId)).model) {
    const key = await resolveAiKey(user.tenantId);
    if (key.kind === "none") throw key.reason === "included_exhausted" ? notConfiguredError(key.reason) : new ApiError(409, "Add your Anthropic key before choosing a model.", "AI_NOT_CONFIGURED");
    await verifyApiKey(key.apiKey, body.model);
  }
  await saveAssistantSettings(user.tenantId, body, user.id);
  return ok(await assistantStatus(user.tenantId));
}, "ADMIN");
