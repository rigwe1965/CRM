// Edge-safe (no Node/Prisma imports): used by middleware and server code alike.
import type { Role } from "@prisma/client";

export const DEFAULT_REDIRECT = "/dashboard";

/** ADMIN passes every role check. An empty `allowed` list means "any signed-in user". */
export function hasRole(role: Role | undefined, allowed: readonly Role[]): boolean {
  if (!role) return false;
  return allowed.length === 0 || role === "ADMIN" || allowed.includes(role);
}

/** Path prefixes that require specific roles. Add new protected areas here. */
const ROLE_RULES: ReadonlyArray<{ prefix: string; roles: readonly Role[] }> = [
  { prefix: "/admin", roles: ["ADMIN"] },
  { prefix: "/api/admin", roles: ["ADMIN"] },
];

export function requiredRolesFor(pathname: string): readonly Role[] | null {
  const rule = ROLE_RULES.find(
    (r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`),
  );
  return rule ? rule.roles : null;
}

const PUBLIC_PAGES = new Set([
  "/sign-in",
  "/forgot-password",
  "/reset-password",
  "/verify-request",
]);
const PUBLIC_PREFIXES = ["/api/auth/","/api/password/", "/api/openapi.json", "/api/health", "/api/cron/"];

export function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PAGES.has(pathname) ||
    PUBLIC_PREFIXES.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p))
  );
}

/**
 * Only allow same-site relative redirects. URL parsers drop tab, CR and LF, so "/<TAB>/evil.com"
 * would become "//evil.com": control characters and backslashes are refused, and the parsed
 * result must stay on the same origin.
 */
export function safeRedirect(url: string | null | undefined): string {
  if (!url || !url.startsWith("/") || /[\u0000-\u001f\u007f\\]/.test(url)) return DEFAULT_REDIRECT;
  const base = "http://internal.invalid";
  try {
    const parsed = new URL(url, base);
    if (parsed.origin !== base) return DEFAULT_REDIRECT;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return DEFAULT_REDIRECT;
  }
}
