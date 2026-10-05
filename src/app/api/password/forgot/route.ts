import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseBody } from "@/lib/api";
import { appUrl, sendMail } from "@/lib/mail";
import { createPasswordResetToken } from "@/lib/tokens";
import { forgotPasswordSchema } from "@/lib/validations/auth";

export async function POST(req: Request) {
  const body = await parseBody(req, forgotPasswordSchema);
  if ("response" in body) return body.response;
  const { email } = body.data;

  // Always respond the same way so this endpoint can't be used to discover registered emails.
  try {
    const user = await db.user.findUnique({ where: { email } });
    if (user?.isActive) {
      const token = await createPasswordResetToken(email);
      const url = `${appUrl()}/reset-password?token=${token}`;
      await sendMail({
        to: email,
        subject: "Reset your CRM password",
        text: `Reset your password:\n${url}\n\nThis link expires in 1 hour. If you didn't request it, ignore this email.`,
        html: `<p>Reset your password:</p><p><a href="${url}">Choose a new password</a></p><p>This link expires in 1 hour. If you didn't request it, ignore this email.</p>`,
      });
    }
  } catch (e) {
    console.error("forgot-password failed", e);
  }
  return NextResponse.json({ ok: true });
}
