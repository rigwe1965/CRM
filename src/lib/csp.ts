// Edge-safe (no Node imports): used by the middleware.

/** Fresh, unguessable value for one response; scripts without it are refused by the browser. */
export function makeNonce(): string {
  return btoa(crypto.randomUUID());
}

/**
 * Content Security Policy for page responses. Scripts need the per-request nonce ('strict-dynamic'
 * lets those scripts load their own chunks); styles keep 'unsafe-inline' because React inline
 * styles and Radix positioning rely on it. Development also needs 'unsafe-eval' for hot reload.
 */
export function buildCsp(nonce: string, isDev = process.env.NODE_ENV !== "production"): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

/** CSP_REPORT_ONLY=1 makes browsers log violations to the console without blocking anything. */
export const cspHeaderName = () =>
  process.env.CSP_REPORT_ONLY === "1" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";
