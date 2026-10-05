import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Nodemailer from "next-auth/providers/nodemailer";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Adapter } from "next-auth/adapters";
import { db } from "@/lib/db";
import { authConfig } from "@/lib/auth.config";
import { getDummyHash, verifyPassword } from "@/lib/password";
import { FROM, sendMail } from "@/lib/mail";
import { signInSchema } from "@/lib/validations/auth";

const prismaAdapter = PrismaAdapter(db);

// User.name is required in our schema, but magic-link sign-up only provides an email.
const adapter: Adapter = {
  ...prismaAdapter,
  createUser: (data) =>
    prismaAdapter.createUser!({ ...data, name: data.name ?? data.email.split("@")[0] }),
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
        await sendMail({
          to: identifier,
          subject: "Your CRM sign-in link",
          text: `Sign in to CRM:\n${url}\n\nThis link expires in 15 minutes. If you didn't request it, ignore this email.`,
          html: `<p>Sign in to CRM:</p><p><a href="${url}">Sign in</a></p><p>This link expires in 15 minutes. If you didn't request it, ignore this email.</p>`,
        });
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
