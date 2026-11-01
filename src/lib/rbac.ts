// Edge-safe (no Node/Prisma imports): used by middleware and server code alike.
import type { Role } from "@prisma/client";

export const DEFAULT_REDIRECT = "/dashboard";

/** ADMIN passes every role check. An empty `allowed` list means "any signed-in user". */
export function hasRole(role: Role | undefined, allowed: readonly Role[]): boolean {
  if (!role) return false;
  return allowed.length === 0 || role === "ADMIN" || allowed.includes(role);
}

/**
 * Admins must have two-step verification. Until they enrol they sign in as a plain SALES user (their
 * own data only, no admin pages) so they can still reach Settings → Security to set it up. On by
 * default in production; set REQUIRE_ADMIN_MFA=0 to switch off, or =1 to force it elsewhere.
 */
export const adminMfaRequired = (env: Record<string, string | undefined> = process.env) => {
  const v = env.REQUIRE_ADMIN_MFA;
  return v === undefined || v === "" ? env.NODE_ENV === "production" : v === "1" || v === "true";
};

export const mfaPending = (role: Role | undefined, mfaEnabled: boolean, required = adminMfaRequired()) =>
  required && role === "ADMIN" && !mfaEnabled;

/** An admin can do the most harm with a stolen session, so theirs lasts a working day at most from the moment they signed in. */
export const ADMIN_SESSION_SECONDS = 12 * 60 * 60;

/** True when a session must end: an admin whose sign-in is older than `ADMIN_SESSION_SECONDS`. `signedInAt` is epoch seconds. */
export const adminSessionExpired = (role: Role | undefined, signedInAt: number | undefined, nowMs = Date.now()) =>
  role === "ADMIN" && signedInAt !== undefined && nowMs / 1000 - signedInAt > ADMIN_SESSION_SECONDS;

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
  "/sign-up",
  "/verify-email",
  "/pay/result",
]);
// /api/webhooks/ is signed by the sender (checked in each route), not by a session.
// /.well-known/ holds security.txt, which must be readable by anyone who finds a vulnerability.
const PUBLIC_PREFIXES = ["/.well-known/", "/api/auth/","/api/password/", "/api/signup", "/api/health", "/api/cron/", "/api/webhooks/", "/api/public/", "/my-order/"];

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
    const target = parsed.pathname + parsed.search + parsed.hash;
    // Dot-segments collapse ("/.//evil.com" -> "//evil.com"), which a browser reads as another site.
    return target.startsWith("//") ? DEFAULT_REDIRECT : target;
  } catch {
    return DEFAULT_REDIRECT;
  }
}
