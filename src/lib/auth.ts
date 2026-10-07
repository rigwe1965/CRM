import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Nodemailer from "next-auth/providers/nodemailer";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Adapter } from "next-auth/adapters";
import { db } from "@/lib/db";
import { authConfig } from "@/lib/auth.config";
import { getDummyHash, verifyPassword } from "@/lib/password";
import { headers } from "next/headers";
import { FROM, sendMail } from "@/lib/mail";
import { magicLinkEmail } from "@/lib/email-templates";
import { clientIp, LIMITS, rateLimit } from "@/lib/rate-limit";
import { getCachedUser } from "@/lib/user-cache";
import { signInSchema } from "@/lib/validations/auth";

const prismaAdapter = PrismaAdapter(db);

// Accounts are created by admins only (POST /api/admin/users). Magic links work for existing users;
// this also stops Auth.js from creating an account for an unknown email.
const adapter: Adapter = {
  ...prismaAdapter,
  createUser: async () => {
    throw new Error("Self-service sign-up is disabled");
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = signInSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        // Throttle password guessing per IP+account. A blocked attempt looks like a wrong password.
        const ip = clientIp(await headers());
        for (const key of [`signin:${ip}:${email}`, `signin-ip:${ip}`]) {
          const limit = await rateLimit(key, key.startsWith("signin-ip") ? { ...LIMITS.signIn, max: 50 } : LIMITS.signIn);
          if (!limit.allowed) return null;
        }

        const user = await db.user.findUnique({ where: { email } });
        const valid = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
        if (!user || !user.passwordHash || !valid || !user.isActive) return null;

        return { id: user.id, email: user.email, name: user.name, image: user.image, role: user.role };
      },
    }),
    Nodemailer({
      server: process.env.EMAIL_SERVER ?? "smtp://localhost:25", // unused: sendVerificationRequest below sends
      from: FROM,
      maxAge: 15 * 60,
      async sendVerificationRequest({ identifier, url }) {
        const limit = await rateLimit(`magic:${identifier}`, LIMITS.magicLink);
        if (!limit.allowed) throw new Error("Too many sign-in link requests");
        // Unknown or deactivated address: send nothing, but look the same as success (no enumeration).
        const known = await db.user.findUnique({ where: { email: identifier }, select: { isActive: true } });
        if (!known?.isActive) return;
        await sendMail({ to: identifier, ...magicLinkEmail(url) });
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user }) {
      // Deactivated accounts can't use magic links either (credentials is checked in authorize).
      return (user as { isActive?: boolean }).isActive !== false;
    },
    // Re-validate against the database on every session read, so role changes, deactivation and
    // password resets take effect quickly instead of when the JWT expires. Lookups of active users
    // are cached for 30 s (src/lib/user-cache.ts): edits made on this instance apply at once, other
    // instances may lag by up to 30 s.
    async jwt({ token, user }) {
      if (user?.role) token.role = user.role;
      if (!token.sub) return null;
      const id = token.sub;

      const current = await getCachedUser(id, () =>
        db.user.findUnique({
          where: { id },
          select: { name: true, role: true, isActive: true, passwordChangedAt: true },
        }),
      );
      if (!current || !current.isActive) return null;
      if (
        current.passwordChangedAt &&
        token.iat &&
        token.iat < Math.floor(current.passwordChangedAt.getTime() / 1000)
      ) {
        return null;
      }
      token.role = current.role;
      token.name = current.name; // keeps the displayed name fresh after profile edits
      return token;
    },
  },
});
