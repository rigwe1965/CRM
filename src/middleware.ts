import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth.config";
import { hasRole, isPublicPath, requiredRolesFor } from "@/lib/rbac";

// Coarse, edge-level gate based on the JWT. Pages and route handlers still re-check with
// requireUser / requireRole / requireApiUser, which validate against the database.
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const path = nextUrl.pathname;

  // CSRF defence in depth (cookies are already SameSite=Lax): state-changing API calls must come
  // from this site. No CORS headers are sent anywhere, so browsers also block cross-origin reads.
  if (path.startsWith("/api/") && !path.startsWith("/api/auth/") && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.headers.get("origin");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (origin && (!URL.canParse(origin) || new URL(origin).host !== host)) {
      return NextResponse.json({ error: "Cross-origin request blocked", code: "FORBIDDEN" }, { status: 403 });
    }
  }

  if (isPublicPath(path)) return;

  const isApi = path.startsWith("/api/");
  const user = req.auth?.user;

  if (!user) {
    if (isApi) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
    const url = new URL("/sign-in", nextUrl);
    url.searchParams.set("callbackUrl", path + nextUrl.search);
    return NextResponse.redirect(url);
  }

  const roles = requiredRolesFor(path);
  if (roles && !hasRole(user.role, roles)) {
    if (isApi) return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
    return NextResponse.redirect(new URL("/unauthorized", nextUrl));
  }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)"],
};
