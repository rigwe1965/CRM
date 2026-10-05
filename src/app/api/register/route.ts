import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { apiError, parseBody } from "@/lib/api";
import { hashPassword } from "@/lib/password";
import { clientIp, LIMITS, rateLimit } from "@/lib/rate-limit";
import { trySendMail } from "@/lib/mail";
import { welcomeEmail } from "@/lib/email-templates";
import { signUpSchema } from "@/lib/validations/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const limit = await rateLimit(`register:${clientIp(req.headers)}`, LIMITS.register);
  if (!limit.allowed) return apiError(`Too many sign-ups. Try again in ${limit.retryAfter}s.`, 429);
  const body = await parseBody(req, signUpSchema);
  if ("response" in body) return body.response;
  const { name, email, password } = body.data;

  try {
    // Role is never taken from the client: new accounts are SALES (schema default).
    await db.user.create({ data: { name, email, passwordHash: await hashPassword(password) } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return apiError("An account with this email already exists", 409, {
        email: ["An account with this email already exists"],
      });
    }
    console.error("register failed", e);
    return apiError("Could not create account. Please try again.", 500);
  }
  // Best effort: the account exists either way.
  await trySendMail({ to: email, ...welcomeEmail(name) });
  return NextResponse.json({ ok: true }, { status: 201 });
}
