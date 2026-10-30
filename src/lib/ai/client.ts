import Anthropic from "@anthropic-ai/sdk";
import { ApiError } from "@/lib/api";
import { getIntegration } from "@/lib/integrations";
import { IVY_MODEL } from "@/lib/ai/pricing";

/**
 * The Anthropic client for one business, built from that business's own key (Settings, or ANTHROPIC_API_KEY for the
 * original business). The key is only ever read here, server-side; it is never logged or returned.
 */
export async function anthropicFor(tenantId: string): Promise<Anthropic> {
  const found = await getIntegration(tenantId, "ANTHROPIC");
  if (!found) throw new ApiError(409, "Ivy has no Anthropic key yet. An admin can add one in Settings.", "AI_NOT_CONFIGURED");
  return new Anthropic({ apiKey: found.settings.apiKey, maxRetries: 2 });
}

/**
 * Checks a key before it is saved with one small, free request: Anthropic's own record of the model Ivy uses. It
 * proves the key is accepted and that it can use the model. Error text never includes the key.
 */
export async function verifyApiKey(apiKey: string): Promise<void> {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 15_000 });
  try {
    await client.models.retrieve(IVY_MODEL);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new ApiError(422, "Anthropic did not accept this key. Check that you copied the whole key.", "AI_KEY_REJECTED");
    if (e instanceof Anthropic.PermissionDeniedError) throw new ApiError(422, "This key is not allowed to use Anthropic's models. Create a standard API key, not an admin key.", "AI_KEY_REJECTED");
    if (e instanceof Anthropic.NotFoundError) throw new ApiError(422, `This key cannot use ${IVY_MODEL}. Check the key's workspace and access in the Anthropic console.`, "AI_MODEL_UNAVAILABLE");
    // Busy right now, but the key itself was accepted.
    if (e instanceof Anthropic.RateLimitError) return;
    if (e instanceof Anthropic.APIConnectionError) throw new ApiError(502, "Could not reach Anthropic to check the key. Try again in a moment.", "AI_UNREACHABLE");
    if (e instanceof Anthropic.APIError) throw new ApiError(502, "Anthropic could not check the key right now. Try again in a moment.", "AI_UNREACHABLE");
    throw e;
  }
}
