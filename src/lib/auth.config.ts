// Edge-safe Auth.js config shared by middleware and the full server config.
// Do not import Prisma, bcrypt or nodemailer here.
import type { NextAuthConfig } from "next-auth";
import type { Role } from "@prisma/client";

export const authConfig = {
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  pages: {
    signIn: "/sign-in",
    error: "/sign-in",
    verifyRequest: "/verify-request",
  },
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user?.role) token.role = user.role;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      if (token.role) session.user.role = token.role as Role;
      session.user.mfaPending = !!token.mfaPending;
      return session;
    },
  },
} satisfies NextAuthConfig;
