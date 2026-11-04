import { beforeEach, describe, expect, it, vi } from "vitest";

const { retrieve, errors, integration } = vi.hoisted(() => {
  class APIError extends Error {}
  class AuthenticationError extends APIError {}
  class PermissionDeniedError extends APIError {}
  class NotFoundError extends APIError {}
  class RateLimitError extends APIError {}
  class APIConnectionError extends APIError {}
  return {
    retrieve: vi.fn(),
    integration: vi.fn(),
    errors: { APIError, AuthenticationError, PermissionDeniedError, NotFoundError, RateLimitError, APIConnectionError },
  };
});

vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    static APIError = errors.APIError;
    static AuthenticationError = errors.AuthenticationError;
    static PermissionDeniedError = errors.PermissionDeniedError;
    static NotFoundError = errors.NotFoundError;
    static RateLimitError = errors.RateLimitError;
    static APIConnectionError = errors.APIConnectionError;
    models = { retrieve };
    constructor(public opts: { apiKey: string }) {}
  }
  return { default: FakeAnthropic };
});
vi.mock("@/lib/integrations", () => ({ getIntegration: integration }));

import { anthropicFor, verifyApiKey } from "@/lib/ai/client";
import { IVY_MODEL } from "@/lib/ai/pricing";

const KEY = "sk-ant-api03-this-is-a-secret-key-0123456789";

beforeEach(() => vi.clearAllMocks());

describe("verifyApiKey", () => {
  it("accepts a key Anthropic accepts, by asking about the model AI uses", async () => {
    retrieve.mockResolvedValue({ id: IVY_MODEL });
    await expect(verifyApiKey(KEY)).resolves.toBeUndefined();
    expect(retrieve).toHaveBeenCalledWith(IVY_MODEL);
  });

  it("turns each failure into a plain message with a code, and never repeats the key", async () => {
    const cases: [Error, number, string][] = [
      [new errors.AuthenticationError(`invalid x-api-key ${KEY}`), 422, "AI_KEY_REJECTED"],
      [new errors.PermissionDeniedError("nope"), 422, "AI_KEY_REJECTED"],
      [new errors.NotFoundError("no such model"), 422, "AI_MODEL_UNAVAILABLE"],
      [new errors.APIConnectionError("offline"), 502, "AI_UNREACHABLE"],
      [new errors.APIError("boom"), 502, "AI_UNREACHABLE"],
    ];
    for (const [thrown, status, code] of cases) {
      retrieve.mockRejectedValueOnce(thrown);
      const e = await verifyApiKey(KEY).catch((x) => x);
      expect(e, code).toMatchObject({ status, code });
      expect(e.message).not.toContain("sk-ant");
    }
  });

  it("accepts a key when Anthropic is only rate limiting, since the key itself was accepted", async () => {
    retrieve.mockRejectedValue(new errors.RateLimitError("slow down"));
    await expect(verifyApiKey(KEY)).resolves.toBeUndefined();
  });

  it("lets an unexpected error through rather than hiding it", async () => {
    retrieve.mockRejectedValue(new TypeError("bug"));
    await expect(verifyApiKey(KEY)).rejects.toThrow("bug");
  });
});

describe("anthropicFor", () => {
  it("builds a client from the business's own key", async () => {
    integration.mockResolvedValue({ settings: { apiKey: KEY }, source: "settings" });
    const client = (await anthropicFor("t1")) as unknown as { opts: { apiKey: string } };
    expect(integration).toHaveBeenCalledWith("t1", "ANTHROPIC");
    expect(client.opts.apiKey).toBe(KEY);
  });

  it("refuses with a clear error when the business has no key", async () => {
    integration.mockResolvedValue(null);
    await expect(anthropicFor("t1")).rejects.toMatchObject({ status: 409, code: "AI_NOT_CONFIGURED" });
  });
});
