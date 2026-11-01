/**
 * The legal documents (terms, privacy policy, data processing addendum) and who the business behind them is.
 * Nothing here imports anything heavy: the sign-up form and the pages share it.
 *
 * LEGAL_VERSION is the date the current wording took effect. Changing it makes every business's admin accept again
 * (see src/lib/legal-acceptance.ts), so change it only when the documents change in a way customers must agree to.
 */
export const LEGAL_VERSION = "2026-11-01";

export type LegalEntity = {
  /** Company or trading name. */
  name: string;
  /** Postal address for legal notices. */
  address: string;
  /** Country or state whose law governs, e.g. "England and Wales". */
  governingLaw: string;
  /** Where privacy questions and requests go. */
  email: string;
  /** True once the owner has had the documents reviewed and says so (LEGAL_REVIEWED=1). Until then the pages carry a draft notice. */
  reviewed: boolean;
  /** True when every detail above was filled in. */
  complete: boolean;
};

const TODO = "[to be completed]";

export function legalEntity(env: Record<string, string | undefined> = process.env): LegalEntity {
  const pick = (v: string | undefined) => v?.trim() || "";
  const name = pick(env.LEGAL_ENTITY_NAME);
  const address = pick(env.LEGAL_ADDRESS);
  const governingLaw = pick(env.LEGAL_GOVERNING_LAW);
  const email = pick(env.SUPPORT_EMAIL);
  return {
    name: name || TODO,
    address: address || TODO,
    governingLaw: governingLaw || TODO,
    email: email || TODO,
    reviewed: env.LEGAL_REVIEWED === "1" && !!(name && address && governingLaw && email),
    complete: !!(name && address && governingLaw && email),
  };
}

/** The settings row written when a business accepts: the version, when, and by whom (null at sign-up, where the audit log names the email). */
export const acceptanceConfig = (acceptedById: string | null, now = new Date()) => ({ version: LEGAL_VERSION, acceptedAt: now.toISOString(), acceptedById });

export const LEGAL_DOCS = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/dpa", label: "Data Processing Addendum" },
] as const;
