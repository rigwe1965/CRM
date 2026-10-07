import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
vi.mock("@/lib/db", () => ({ db: { user: { findFirst: (...a: unknown[]) => findFirst(...a) } } }));
import { liveFilter, ownerScope, resolveOwner } from "@/lib/access";
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
  });
  it("blocks open redirects", () => {
    expect(safeRedirect("//evil.com")).toBe("/dashboard");
    expect(safeRedirect("/deals")).toBe("/deals");
  });
});

