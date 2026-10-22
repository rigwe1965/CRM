/**
 * Cloudflare Turnstile, the CAPTCHA on the public sign-up form. Free, no puzzles for most people, and it sets no
 * advertising cookies. Needs TURNSTILE_SITE_KEY (public, shown in the page) and TURNSTILE_SECRET_KEY (server only).
 * With neither set there is no CAPTCHA: fine for development, refused in production while sign-up is open (env.ts).
 */
export const captchaConfigured = () => !!process.env.TURNSTILE_SECRET_KEY && !!process.env.TURNSTILE_SITE_KEY;
export const captchaSiteKey = () => (captchaConfigured() ? process.env.TURNSTILE_SITE_KEY! : null);

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** True only when Cloudflare confirms this one-time token. Any failure to ask (network, bad reply) counts as "no". */
export async function verifyCaptcha(token: string | undefined, ip?: string): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY!, response: token, ...(ip && ip !== "unknown" && { remoteip: ip }) }),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    return ((await res.json()) as { success?: boolean }).success === true;
  } catch (e) {
    console.error("[captcha] verification failed", e instanceof Error ? e.message : e);
    return false;
  }
}
