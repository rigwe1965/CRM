/**
 * Where a customer goes for help, and where they can see whether the service is up. Both come from the environment
 * (SUPPORT_EMAIL, STATUS_PAGE_URL) so no personal address is kept in the code, and each is shown only when it is set
 * and well formed. This file imports nothing heavy, because the start-up check (which reads it) is also built for the edge. SECURITY_EMAIL, for people who find a vulnerability, falls back to the support address.
 */
export type SupportInfo = { email: string | null; statusUrl: string | null };

const EMAIL = /^[^\s@<>"',;:]+@[^\s@<>"',;:]+\.[^\s@<>"',;:]{2,}$/;
const clean = (v: string | undefined) => v?.trim() || "";

export const validEmail = (v: string | undefined) => EMAIL.test(clean(v));
export const validHttpsUrl = (v: string | undefined) => URL.canParse(clean(v)) && new URL(clean(v)).protocol === "https:";

export function supportInfo(env: Record<string, string | undefined> = process.env): SupportInfo {
  return {
    email: validEmail(env.SUPPORT_EMAIL) ? clean(env.SUPPORT_EMAIL) : null,
    statusUrl: validHttpsUrl(env.STATUS_PAGE_URL) ? clean(env.STATUS_PAGE_URL) : null,
  };
}

export function securityContact(env: Record<string, string | undefined> = process.env): string | null {
  if (validEmail(env.SECURITY_EMAIL)) return clean(env.SECURITY_EMAIL);
  return supportInfo(env).email;
}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/** The text of /.well-known/security.txt (RFC 9116; `base` is the site address): who to tell, and until when this file can be trusted. Null when there is no contact. */
export function securityTxt(base: string, env: Record<string, string | undefined> = process.env, now = new Date()): string | null {
  const contact = securityContact(env);
  if (!contact) return null;
  return [
    `Contact: mailto:${contact}`,
    `Expires: ${new Date(now.getTime() + YEAR_MS).toISOString()}`,
    "Preferred-Languages: en",
    `Canonical: ${base}/.well-known/security.txt`,
    "",
  ].join("\n");
}
