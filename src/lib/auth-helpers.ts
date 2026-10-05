import "server-only";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { auth } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { hasRole } from "@/lib/rbac";

export async function getCurrentUser() {
  const session = await auth();
  return session?.user ?? null;
}

/** For pages/layouts/server actions: redirects to sign-in when signed out. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}

/** For pages/layouts: redirects to /unauthorized unless the user has one of the roles (ADMIN always passes). */
export async function requireRole(...roles: Role[]) {
  const user = await requireUser();
  if (!hasRole(user.role, roles)) redirect("/unauthorized");
  return user;
}

type SessionUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

/**
 * For route handlers. Usage:
 *   const guard = await requireApiUser("ADMIN");
 *   if (!guard.ok) return guard.response;
 *   guard.user ...
 */
export async function requireApiUser(
  ...roles: Role[]
): Promise<{ ok: true; user: SessionUser } | { ok: false; response: Response }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, response: apiError("Unauthorized", 401) };
  if (!hasRole(user.role, roles)) return { ok: false, response: apiError("Forbidden", 403) };
  return { ok: true, user };
}
