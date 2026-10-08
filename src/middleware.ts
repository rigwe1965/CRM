import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth.config";
import { buildCsp, cspHeaderName, makeNonce } from "@/lib/csp";
import { hasRole, isPublicPath, requiredRolesFor } from "@/lib/rbac";

// Coarse, edge-level gate based on the JWT. Pages and route handlers still re-check with
// requireUser / requireRole / requireApiUser, which validate against the database.
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const path = nextUrl.pathname;
  const isApi = path.startsWith("/api/");

  // CSRF defence in depth (cookies are already SameSite=Lax): state-changing API calls must come
  // from this site. No CORS headers are sent anywhere, so browsers also block cross-origin reads.
  if (isApi && !path.startsWith("/api/auth/") && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.headers.get("origin");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (origin && (!URL.canParse(origin) || new URL(origin).host !== host)) {
      return NextResponse.json({ error: "Cross-origin request blocked", code: "FORBIDDEN" }, { status: 403 });
    }
  }

  if (!isPublicPath(path)) {
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
  }

  // API responses are JSON: no scripts to protect. Pages get a per-request nonce, passed to the
  // renderer as a request header (Next stamps it on its own scripts) and enforced via the response.
  if (isApi) return;
  const nonce = makeNonce();
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(cspHeaderName(), csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set(cspHeaderName(), csp);
  return res;
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)"],
};
