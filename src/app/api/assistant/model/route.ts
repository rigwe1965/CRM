import { z } from "zod";
import { ApiError, ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { notConfiguredError, resolveAiKey } from "@/lib/ai/included";
import { verifyApiKey } from "@/lib/ai/client";
import { SELECTABLE_MODEL_IDS } from "@/lib/ai/models";
import { loadAssistantSettings, loadUserModel, saveUserModel } from "@/lib/ai/settings";
import { userModelState } from "@/lib/ai/status";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * GET /api/assistant/model: whether this person may choose their own Claude model, what they chose, and what applies to
 * them. For every signed-in user; it holds no spending figures and never a key.
 */
export const GET = authed(async ({ user }) => ok(await userModelState(user.tenantId, user.id)));

/**
 * PUT /api/assistant/model { model }: sets this person's own model, or { model: null } to follow the business's again. Only
 * while an admin has allowed it (Settings > AI). A different model is saved only once the business's key is shown to be
 * allowed to use it, so a choice can never leave this person's AI broken.
 */
export const PUT = authed(async ({ req, user }) => {
  const { model } = await readBody(req, z.object({ model: z.enum(SELECTABLE_MODEL_IDS).nullable() }));
  const settings = await loadAssistantSettings(user.tenantId);
  if (settings.userModelChoice !== true) throw new ApiError(403, "Your admin has not allowed everyone to choose their own model. Ask them in Settings, under AI assistant.", "AI_USER_MODEL_OFF");
  if (model !== null && model !== (await loadUserModel(user.tenantId, user.id))) {
    await enforceRateLimit(`ai:model:${user.id}`, LIMITS.assistant);
    const key = await resolveAiKey(user.tenantId);
    if (key.kind === "none") throw key.reason === "included_exhausted" ? notConfiguredError(key.reason) : new ApiError(409, "AI has no Anthropic key yet, so a model cannot be chosen.", "AI_NOT_CONFIGURED");
    await verifyApiKey(key.apiKey, model);
  }
  await saveUserModel(user.tenantId, user.id, model);
  return ok(await userModelState(user.tenantId, user.id));
});
