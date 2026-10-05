import nodemailer from "nodemailer";

type Mail = { to: string; subject: string; text: string; html?: string };

export const FROM = process.env.EMAIL_FROM ?? "CRM <noreply@localhost>";

/**
 * Minimal transport for auth emails (magic links, password reset).
 * Without EMAIL_SERVER, messages are printed to the server console in development.
 */
export async function sendMail({ to, subject, text, html }: Mail) {
  const server = process.env.EMAIL_SERVER;
  if (!server) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("EMAIL_SERVER is not configured");
    }
    console.log(`\n[mail:dev] To: ${to}\n[mail:dev] Subject: ${subject}\n${text}\n`);
    return;
  }
  await nodemailer.createTransport(server).sendMail({ from: FROM, to, subject, text, html });
}

export const appUrl = () => process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? "http://localhost:3000";
