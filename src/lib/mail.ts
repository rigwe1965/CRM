import nodemailer from "nodemailer";
import { Resend } from "resend";

export type Mail = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  /** Overrides EMAIL_FROM, e.g. `"Ada via CRM" <noreply@example.com>`. */
  from?: string;
};

export const FROM = process.env.EMAIL_FROM ?? "CRM <noreply@localhost>";

let resend: Resend | undefined;

/**
 * Sends one email. Provider is chosen from the environment:
 *   RESEND_API_KEY → Resend (preferred) · EMAIL_SERVER → SMTP via Nodemailer ·
 *   neither → printed to the server console (development only; throws in production).
 * Throws when the provider rejects the message, so callers decide whether that is fatal.
 */
export async function sendMail({ to, subject, text, html, replyTo, from = FROM }: Mail) {
  if (/[\r\n]/.test(subject)) throw new Error("Email subject must be a single line");

  if (process.env.RESEND_API_KEY) {
    resend ??= new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({ from, to, subject, text, html, replyTo });
    if (error) throw new Error(`Resend: ${error.name}: ${error.message}`);
    return;
  }

  if (process.env.EMAIL_SERVER) {
    await nodemailer.createTransport(process.env.EMAIL_SERVER).sendMail({ from, to, subject, text, html, replyTo });
    return;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("No email provider configured: set RESEND_API_KEY (or EMAIL_SERVER)");
  }
  console.log(`\n[mail:dev] To: ${[to].flat().join(", ")}\n[mail:dev] Subject: ${subject}\n${text}\n`);
}

/**
 * Like sendMail, but never throws: for notifications where a delivery failure must not fail the
 * request that triggered them. Returns whether the message was handed to the provider.
 */
export async function trySendMail(mail: Mail): Promise<boolean> {
  try {
    await sendMail(mail);
    return true;
  } catch (e) {
    console.error(`[mail] failed to send "${mail.subject}"`, e instanceof Error ? e.message : e);
    return false;
  }
}

/** Public base URL of the app, without a trailing slash. */
export function appUrl() {
  const explicit = process.env.NEXTAUTH_URL ?? process.env.AUTH_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  // Vercel exposes the stable production domain and the per-deployment domain (no protocol).
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}
