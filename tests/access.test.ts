import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
vi.mock("@/lib/db", () => ({ db: { user: { findFirst: (...a: unknown[]) => findFirst(...a) } } }));
import { liveFilter, ownerScope, resolveOwner, wouldLeaveNoAdmin } from "@/lib/access";
import { hasRole, isPublicPath, requiredRolesFor, safeRedirect } from "@/lib/rbac";

type U = Parameters<typeof ownerScope>[0];
const sales = { id: "u1", role: "SALES" } as U;
const admin = { id: "a1", role: "ADMIN" } as U;

beforeEach(() => findFirst.mockReset());

describe("ownerScope / liveFilter", () => {
  it("scopes non-admins to their own rows and lets admins see all", () => {
    expect(ownerScope(sales)).toEqual({ ownerId: "u1" });
    expect(ownerScope(admin)).toEqual({});
  });
  it("only admins can see deleted rows", () => {
    expect(liveFilter(sales, true)).toEqual({ deletedAt: null });
    expect(liveFilter(admin, true)).toEqual({});
    expect(liveFilter(admin)).toEqual({ deletedAt: null });
  });
});

describe("resolveOwner", () => {
  it("defaults to the current user", async () => expect(await resolveOwner(sales, undefined)).toBe("u1"));
  it("blocks non-admins assigning others or unassigning", async () => {
    await expect(resolveOwner(sales, "other")).rejects.toMatchObject({ status: 403 });
    await expect(resolveOwner(sales, null)).rejects.toMatchObject({ status: 403 });
  });
  it("lets admins assign an active user, and rejects unknown ones", async () => {
    findFirst.mockResolvedValueOnce({ id: "u2" });
    expect(await resolveOwner(admin, "u2")).toBe("u2");
    findFirst.mockResolvedValueOnce(null);
    await expect(resolveOwner(admin, "nope")).rejects.toMatchObject({ status: 422 });
  });
});

describe("wouldLeaveNoAdmin", () => {
  const admin = { role: "ADMIN", isActive: true };
  it("blocks removing the only active admin", () => {
    expect(wouldLeaveNoAdmin({ target: admin, demoting: true, deactivating: false, otherActiveAdmins: 0 })).toBe(true);
    expect(wouldLeaveNoAdmin({ target: admin, demoting: false, deactivating: true, otherActiveAdmins: 0 })).toBe(true);
  });
  it("allows it when another active admin remains", () => {
    expect(wouldLeaveNoAdmin({ target: admin, demoting: true, deactivating: false, otherActiveAdmins: 1 })).toBe(false);
  });
  it("ignores changes that don't remove an admin", () => {
    expect(wouldLeaveNoAdmin({ target: { role: "SALES", isActive: true }, demoting: true, deactivating: false, otherActiveAdmins: 0 })).toBe(false);
    expect(wouldLeaveNoAdmin({ target: { role: "ADMIN", isActive: false }, demoting: false, deactivating: true, otherActiveAdmins: 0 })).toBe(false);
    expect(wouldLeaveNoAdmin({ target: admin, demoting: false, deactivating: false, otherActiveAdmins: 0 })).toBe(false);
  });
});

describe("rbac", () => {
  it("admin passes every role check", () => {
    expect(hasRole("ADMIN", ["SALES"])).toBe(true);
    expect(hasRole("SUPPORT", ["SALES"])).toBe(false);
    expect(hasRole(undefined, [])).toBe(false);
  });
  it("protects /api/admin", () => expect(requiredRolesFor("/api/admin/users")).toEqual(["ADMIN"]));
  it("public sign-up is closed", () => {
    expect(isPublicPath("/sign-up")).toBe(false);
    expect(isPublicPath("/api/register")).toBe(false);
    expect(isPublicPath("/sign-in")).toBe(true);
    expect(isPublicPath("/api/cron/task-reminders")).toBe(true);
    expect(isPublicPath("/api/openapi.json")).toBe(false); // the API map needs a session
  });
  it("blocks open redirects", () => {
    expect(safeRedirect("//evil.com")).toBe("/dashboard");
    expect(safeRedirect("/deals")).toBe("/deals");
    expect(safeRedirect("/deals?stage=PROPOSAL#top")).toBe("/deals?stage=PROPOSAL#top");
    expect(safeRedirect("/\\evil.com")).toBe("/dashboard");
    // Parsers strip tab/CR/LF, which would turn these into "//evil.com".
    for (const bad of ["/\t/evil.com", "/\n/evil.com", "/\r/evil.com"]) expect(safeRedirect(bad)).toBe("/dashboard");
    expect(safeRedirect("/%09/evil.com")).toBe("/%09/evil.com"); // percent-encoded stays a path
    // Dot-segments collapse to "//evil.com" once parsed.
    for (const bad of ["/.//evil.com", "/..//evil.com", "/a/..//evil.com", "/%2e//evil.com", "/%2E%2E//evil.com"]) {
      expect(safeRedirect(bad)).toBe("/dashboard");
    }
    expect(safeRedirect("/a/../deals")).toBe("/deals");
  });
});

