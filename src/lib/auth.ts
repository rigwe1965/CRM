import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Nodemailer from "next-auth/providers/nodemailer";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Adapter } from "next-auth/adapters";
import { db } from "@/lib/db";
import { authConfig } from "@/lib/auth.config";
import { getDummyHash, verifyPassword } from "@/lib/password";
import { headers } from "next/headers";
import { FROM, sendMail, trySendMail } from "@/lib/mail";
import { magicLinkEmail, welcomeEmail } from "@/lib/email-templates";
import { clientIp, LIMITS, rateLimit } from "@/lib/rate-limit";
import { signInSchema } from "@/lib/validations/auth";

const prismaAdapter = PrismaAdapter(db);

// User.name is required in our schema, but magic-link sign-up only provides an email.
const adapter: Adapter = {
  ...prismaAdapter,
  // Magic-link sign-up is the only path through here, so this is also where its welcome email goes.
  createUser: async (data) => {
    const user = await prismaAdapter.createUser!({ ...data, name: data.name ?? data.email.split("@")[0] });
    await trySendMail({ to: user.email, ...welcomeEmail(user.name ?? user.email) });
    return user;
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
          const limit = await rateLimit(key, key.startsWith("signin-ip") ? { max: 50, windowMs: LIMITS.signIn.windowMs } : LIMITS.signIn);
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
    // password resets take effect immediately instead of when the JWT expires.
    async jwt({ token, user }) {
      if (user?.role) token.role = user.role;
      if (!token.sub) return null;

      const current = await db.user.findUnique({
        where: { id: token.sub },
        select: { name: true, role: true, isActive: true, passwordChangedAt: true },
      });
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
