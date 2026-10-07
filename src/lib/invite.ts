import { inviteEmail } from "@/lib/email-templates";
import { appUrl, mailIsConsoleOnly, trySendMail } from "@/lib/mail";
import { createPasswordResetToken, INVITE_TTL_MS } from "@/lib/tokens";

/**
 * Issues a 7-day set-password link and emails it. With no email provider in development nothing is
 * delivered, so the link is returned as `devLink` for the admin to open or pass on.
 */
export async function sendInvite(name: string, email: string) {
  const link = `${appUrl()}/reset-password?token=${await createPasswordResetToken(email, INVITE_TTL_MS)}`;
  const emailed = await trySendMail({ to: email, ...inviteEmail(name, link) });
  return { emailed, devLink: mailIsConsoleOnly() ? link : undefined };
}
