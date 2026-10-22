import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The business a piece of work is running for (Phase 2 of MULTI_TENANCY_PLAN.md). `authed()` sets it from the
 * session; the public form, the webhooks and the daily jobs set it from the business they act for. The database
 * client (src/lib/db.ts) hands it to Postgres on every query, where row-level security refuses any row of
 * another business.
 */
// Held on globalThis so every route bundle in the process shares one store.
const g = globalThis as unknown as { __tenantContext?: AsyncLocalStorage<string> };
const store = (g.__tenantContext ??= new AsyncLocalStorage<string>());

/**
 * Runs `fn` (and everything it awaits) as the given business. `fn` is awaited inside the scope on purpose: a Prisma
 * query is lazy and only starts when something awaits it, so returning it un-awaited would run it after the scope
 * had ended, with no business set.
 */
export const withTenant = <T>(tenantId: string, fn: () => PromiseLike<T>): Promise<T> => store.run(tenantId, async () => await fn());

export const currentTenantId = () => store.getStore();

/**
 * Captures the current business and returns a runner that re-enters it. For work that outlives the request
 * handler, such as a streamed download whose rows are read after `authed()` has returned.
 */
export function keepTenant(): <T>(fn: () => PromiseLike<T>) => Promise<T> {
  const tenantId = store.getStore();
  return (fn) => (tenantId ? withTenant(tenantId, fn) : Promise.resolve(fn()));
}
