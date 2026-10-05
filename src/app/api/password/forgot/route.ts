import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { apiError, parseBody } from "@/lib/api";
import { appUrl, sendMail } from "@/lib/mail";
import { passwordResetEmail } from "@/lib/email-templates";
import { clientIp, LIMITS, rateLimit } from "@/lib/rate-limit";
import { createPasswordResetToken } from "@/lib/tokens";
import { forgotPasswordSchema } from "@/lib/validations/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await parseBody(req, forgotPasswordSchema);
  if ("response" in body) return body.response;
  const { email } = body.data;

  // Limit per IP and per target address (stops both bulk probing and mailbox flooding).
  for (const key of [`forgot-ip:${clientIp(req.headers)}`, `forgot-email:${email}`]) {
    const limit = await rateLimit(key, LIMITS.passwordForgot);
    if (!limit.allowed) return apiError(`Too many requests. Try again in ${limit.retryAfter}s.`, 429);
  }

  // Always respond the same way so this endpoint can't be used to discover registered emails.
  try {
    const user = await db.user.findUnique({ where: { email } });
    if (user?.isActive) {
      const token = await createPasswordResetToken(email);
      const url = `${appUrl()}/reset-password?token=${token}`;
      await sendMail({ to: email, ...passwordResetEmail(url) });
    }
  } catch (e) {
    console.error("forgot-password failed", e);
  }
  return NextResponse.json({ ok: true });
}
