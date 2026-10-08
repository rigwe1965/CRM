import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCachedUser, invalidateUserCache, USER_CACHE_TTL_MS, type CachedUser } from "@/lib/user-cache";

const active: CachedUser = { name: "Sam", role: "SALES", isActive: true, passwordChangedAt: null, mfaEnabled: false };
const load = vi.fn<() => Promise<CachedUser | null>>();

beforeEach(() => {
  load.mockReset();
  invalidateUserCache("u1");
});

describe("getCachedUser", () => {
  it("serves repeat lookups from the cache within the TTL", async () => {
    load.mockResolvedValue(active);
    await getCachedUser("u1", load, 1000);
    await getCachedUser("u1", load, 1000 + USER_CACHE_TTL_MS - 1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("re-queries after the TTL", async () => {
    load.mockResolvedValue(active);
    await getCachedUser("u1", load, 1000);
    await getCachedUser("u1", load, 1000 + USER_CACHE_TTL_MS + 1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("re-queries after invalidation", async () => {
    load.mockResolvedValue(active);
    await getCachedUser("u1", load, 1000);
    invalidateUserCache("u1");
    await getCachedUser("u1", load, 1001);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("never caches missing or inactive users", async () => {
    load.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...active, isActive: false }).mockResolvedValueOnce(active);
    expect(await getCachedUser("u1", load, 1000)).toBeNull();
    expect((await getCachedUser("u1", load, 1001))?.isActive).toBe(false);
    expect((await getCachedUser("u1", load, 1002))?.isActive).toBe(true);
    expect(load).toHaveBeenCalledTimes(3);
  });
});
