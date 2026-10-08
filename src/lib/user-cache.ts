import type { Role } from "@prisma/client";

/**
 * Short-lived, in-process cache for the per-request user check done by the Auth.js `jwt` callback.
 * Only active users are cached, so a deactivated or deleted user is rejected on the very next call.
 * Edits made on this server instance call `invalidateUserCache` and apply immediately; on a
 * multi-instance deployment another instance can serve a stale role for up to TTL_MS.
 */
export const USER_CACHE_TTL_MS = 30_000;

export type CachedUser = { name: string; role: Role; isActive: boolean; passwordChangedAt: Date | null; mfaEnabled: boolean };

// Held on globalThis so every route bundle in the process shares one cache.
const g = globalThis as unknown as { __userCache?: Map<string, { value: CachedUser; expiresAt: number }> };
const cache = (g.__userCache ??= new Map());

export async function getCachedUser(id: string, load: () => Promise<CachedUser | null>, now = Date.now()) {
  const hit = cache.get(id);
  if (hit && hit.expiresAt > now) return hit.value;
  const value = await load();
  if (value?.isActive) cache.set(id, { value, expiresAt: now + USER_CACHE_TTL_MS });
  else cache.delete(id);
  return value;
}

export function invalidateUserCache(id: string) {
  cache.delete(id);
}
