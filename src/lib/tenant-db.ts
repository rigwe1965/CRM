import type { PrismaClient } from "@prisma/client";
import { currentTenantId } from "@/lib/tenant-context";

/** A query ran outside `withTenant`. Thrown rather than sent to the database, which would only return no rows. */
export class NoTenantContextError extends Error {
  constructor() {
    super("Database query outside a business context: wrap it in withTenant(), or use platformDb for work that spans businesses");
  }
}

const need = () => {
  const id = currentTenantId();
  if (!id) throw new NoTenantContextError();
  return id;
};

/**
 * Phase 2 of MULTI_TENANCY_PLAN.md: row-level security as the backstop under the application filters.
 *
 * Every table's policy compares its `tenantId` with the Postgres setting `app.tenant_id`. This client sets that
 * setting inside the same transaction as each query (`set_config(..., true)` lasts for the transaction only), so
 * it works through a pooled connection: the setting never outlives the query, and a connection handed to the next
 * request carries nothing over. With the setting missing, a policy matches no row, so a forgotten context fails
 * closed. The database role this client connects as must not bypass row-level security (see TECHNICIAN.md).
 *
 * Three cases, told apart by Prisma's internal transaction marker:
 * - a single query outside a transaction: run as a two-statement transaction [set the business, run the query];
 * - `$transaction(async tx => ...)`: the business is set first, then the callback runs on the plain transaction
 *   client, so its queries need no wrapping;
 * - `$transaction([a, b])`: the business is set as the first statement of the batch.
 * Queries already inside one of those transactions pass straight through.
 */
export function createTenantDb(base: PrismaClient) {
  const setTenant = (client: Pick<PrismaClient, "$executeRaw">, tenantId: string) =>
    client.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

  const transaction = ((arg: unknown, options?: unknown) => {
    let tenantId: string;
    try {
      tenantId = need();
    } catch (e) {
      return Promise.reject(e); // like Prisma's own $transaction, a failure arrives as a rejected promise
    }
    if (typeof arg === "function") {
      return base.$transaction(async (tx) => {
        await setTenant(tx, tenantId);
        return (arg as (tx: unknown) => unknown)(tx);
      }, options as never);
    }
    return base.$transaction([setTenant(base, tenantId), ...(arg as never[])], options as never).then((rows) => (rows as unknown[]).slice(1));
  }) as PrismaClient["$transaction"];

  return base.$extends({
    client: { $transaction: transaction },
    query: {
      async $allOperations({ args, query, ...rest }) {
        // `__internalParams` is not public API; tests/rls.test.ts fails if a Prisma upgrade changes it.
        const internal = (rest as { __internalParams?: { transaction?: unknown } }).__internalParams;
        if (internal?.transaction) return query(args);
        const tenantId = need();
        const [, result] = await base.$transaction([setTenant(base, tenantId), query(args)]);
        return result;
      },
    },
  });
}
