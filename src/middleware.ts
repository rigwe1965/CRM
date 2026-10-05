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
