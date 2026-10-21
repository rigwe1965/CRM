/**
 * Turns a free-text phone number into E.164 (`+4915906462275`), or null when it can't be done safely.
 * Understands `+49…` and `0049…`. A national number with a single leading 0 (`0803…`) is only
 * completed when `defaultCallingCode` (digits, e.g. "234") is given; anything else is left alone
 * rather than guessed.
 */
export function toE164(phone: string | null | undefined, defaultCallingCode?: string | null): string | null {
  const raw = phone?.trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  let full: string | null = null;
  if (raw.startsWith("+")) full = digits;
  else if (digits.startsWith("00")) full = digits.slice(2);
  else if (digits.startsWith("0") && !digits.startsWith("00") && defaultCallingCode && /^[1-9]\d{0,3}$/.test(defaultCallingCode)) {
    full = defaultCallingCode + digits.slice(1);
  }
  if (!full || !/^[1-9]\d{7,14}$/.test(full)) return null;
  return `+${full}`;
}

/** Server-side normaliser: uses DEFAULT_PHONE_COUNTRY_CODE from the environment when set. */
export const normalizePhone = (phone: string | null | undefined) => toE164(phone, process.env.DEFAULT_PHONE_COUNTRY_CODE);
