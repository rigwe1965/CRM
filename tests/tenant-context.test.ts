import { describe, expect, it, vi } from "vitest";
import { currentTenantId, keepTenant, withTenant } from "@/lib/tenant-context";

// Phase 2 of MULTI_TENANCY_PLAN.md. The database client reads the business from this context when a query starts,
// so the context must still be in place at that moment.

/** Shaped like a Prisma query: it does nothing until something awaits it, and reads the business only then. */
const lazyQuery = (seen: (string | undefined)[]) => ({
  then: (resolve: (v: string | undefined) => unknown) => {
    seen.push(currentTenantId());
    return resolve(currentTenantId());
  },
});

const { createAudit } = vi.hoisted(() => ({ createAudit: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { auditLog: { create: createAudit } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { audit } from "@/lib/audit";

describe("withTenant", () => {
  it("sets the business for everything awaited inside", async () => {
    expect(await withTenant("t1", async () => currentTenantId())).toBe("t1");
    expect(currentTenantId()).toBeUndefined();
  });

  it("starts a lazy query inside the scope, even when the callback returns it un-awaited", async () => {
    const seen: (string | undefined)[] = [];
    await withTenant("t1", () => lazyQuery(seen) as unknown as Promise<unknown>);
    expect(seen).toEqual(["t1"]);
  });

  it("nests: the inner business wins and the outer one comes back", async () => {
    const seen = await withTenant("outer", async () => [currentTenantId(), await withTenant("inner", async () => currentTenantId()), currentTenantId()]);
    expect(seen).toEqual(["outer", "inner", "outer"]);
  });

  it("keepTenant lets work that outlives the handler (a streamed download) run in the original business", async () => {
    const inTenant = await withTenant("t1", async () => keepTenant());
    expect(await inTenant(async () => currentTenantId())).toBe("t1");
    expect(await keepTenant()(async () => currentTenantId())).toBeUndefined();
  });
});

describe("audit outside a request", () => {
  it("writes the row as its own business, so a sign-in failure with no session is not lost", async () => {
    const seen: (string | undefined)[] = [];
    createAudit.mockImplementation(() => lazyQuery(seen));
    await audit({ tenantId: "t9" }, { action: "auth.signin.failed" });
    await audit(null, { action: "auth.signin.failed" });
    expect(seen).toEqual(["t9", "platform"]);
  });
});
