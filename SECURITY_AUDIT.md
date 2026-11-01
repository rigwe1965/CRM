# Security Audit Log: Ivycandy Hair CRM

- **Date:** 2026-10-08
- **Scope:** whole repository at commit `710b636` (Next.js 15 App Router, Auth.js v5, Prisma/PostgreSQL, Upstash rate limiting, Resend/SMTP mail). Read: every route handler under `src/app/api`, `src/middleware.ts`, `src/lib/*`, validation schemas, `next.config.mjs`, the deployment config, CI, Docker, seed and scripts, the client import/API code.
- **Method:** manual code review, plus `npm audit --omit=dev` (0 known vulnerabilities) and a scan of git history and tracked files for secrets (none found; `.env` was never committed).
- **Status:** findings 1 to 3 (branch `security-fixes-1-3`) and 4 to 7 (branch `security-fixes-4-7`) and 8 to 13 (branch `security-fixes-8-13`) were fixed after the owner approved a plan (see "Fix status" under each).

## Summary

| # | Severity | Finding | Location |
| --- | --- | --- | --- |
| 1 | Medium | Open redirect: `safeRedirect` bypassed with tab/newline characters | `src/lib/rbac.ts:41` |
| 2 | Medium | Payment overpayment race (check-then-insert at Read Committed) | `src/app/api/deals/[id]/payments/route.ts:32` |
| 3 | Medium | Deal `amount`/`currency` can be edited below what is already paid | `src/app/api/deals/[id]/route.ts:29-61` |
| 4 | Low | Anyone can lock any account out of sign-in (shared per-account limiter) | `src/lib/rate-limit.ts:78`, `src/lib/auth.ts:46`, `src/app/api/auth/mfa-check/route.ts:25` |
| 5 | Low | Change password needs no rate limit and no second factor | `src/app/api/me/password/route.ts:26` |
| 6 | Low | Two-step verification is optional, even for ADMIN | `src/lib/auth.ts`, `src/lib/validations/auth.ts` |
| 7 | Low | `/api/admin/*` and `/api/me/*` bypass the `authed()` wrapper (no API rate limit, hand-rolled audit) | `src/app/api/admin/**`, `src/app/api/me/**` |
| 8 | Low | CSP allows `'unsafe-inline'` scripts | `next.config.mjs:7` |
| 9 | Low | Last-admin guard only covers self-demotion (two admins can leave zero) | `src/app/api/admin/users/[id]/route.ts:19-24` |
| 10 | Info | MFA secret key is a bare SHA-256 of `NEXTAUTH_SECRET` | `src/lib/mfa.ts:71-75` |
| 11 | Info | Task/deal titles with a newline silently break reminder and stage emails | `src/lib/notifications.ts`, `src/lib/mail.ts:25` |
| 12 | Info | Public OpenAPI document; seed users with a known password | `src/app/api/openapi.json/route.ts`, `prisma/seed.ts:36` |
| 13 | Info | Multi-instance caches: role/deactivation lag up to 30 s | `src/lib/user-cache.ts` |

No Critical or High findings. No SQL injection (the four `$queryRaw` calls in `src/lib/cashflow.ts` use tagged templates and `Prisma.sql` parameters), no `dangerouslySetInnerHTML`, no `eval`, no hard-coded secrets, no IDOR found on the owner-scoped resources, and no mass assignment (every body goes through a Zod object schema that strips unknown keys).

---

## 1. Open redirect through `safeRedirect` (Medium)

**File:** `src/lib/rbac.ts:41-46`, used at `src/components/auth/sign-in-form.tsx:18` and `src/app/(auth)/sign-in/page.tsx:15`.

```ts
export function safeRedirect(url: string | null | undefined): string {
  if (!url || !url.startsWith("/") || url.startsWith("//") || url.startsWith("/\\")) {
    return DEFAULT_REDIRECT;
  }
  return url;
}
```

**Risk.** The WHATWG URL parser deletes tab, CR and LF characters before parsing. `/\t/evil.com` does not start with `//` or `/\`, so it passes, but a browser resolves it to `//evil.com`. Verified:

```text
new URL("/\t/evil.com", "https://app.example.com").href  ->  https://evil.com/
new URL("/\n/evil.com", ...)                              ->  https://evil.com/
new URL("/\r/evil.com", ...)                              ->  https://evil.com/
```

**Attack.** Attacker sends a phishing link `https://crm.example/sign-in?callbackUrl=%2F%09%2Fevil.com`. The victim signs in on the real site (or is already signed in: the server page redirects immediately) and lands on `evil.com`, which can show a convincing "session expired, re-enter your password and code" page. The existing test (`tests/access.test.ts:54`) only covers `//evil.com`.

**Likely fix.** Parse the value and require same-origin; reject control characters outright.

```ts
export function safeRedirect(url: string | null | undefined): string {
  if (!url || !url.startsWith("/") || /[\u0000-\u001f\u007f\\]/.test(url)) return DEFAULT_REDIRECT;
  try {
    const base = "http://internal.invalid";
    const parsed = new URL(url, base);
    if (parsed.origin !== base) return DEFAULT_REDIRECT;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return DEFAULT_REDIRECT;
  }
}
```

Add tests for `"/\t/evil.com"`, `"/\n/evil.com"`, `"/\r/evil.com"`, `"/%2f/evil.com"` (stays a path) and `"/deals?x=1"` (kept).

**Fix status: fixed.** `safeRedirect` now refuses control characters and backslashes and requires the parsed URL to stay on the same origin; tests added in `tests/access.test.ts`.

---

## 2. Payment overpayment race (Medium)

**File:** `src/app/api/deals/[id]/payments/route.ts:32-40`

```ts
await db.$transaction(async (tx) => {
  const { _sum } = await tx.payment.aggregate({ where: { dealId: deal.id }, _sum: { amount: true } });
  const balance = Math.round((Number(deal.amount) - Number(_sum.amount ?? 0)) * 100) / 100;
  if (body.amount > balance) { ... throw new ApiError(422, ...) }
  await tx.payment.create({ data: { ...body, dealId: deal.id, recordedById: user.id } });
});
```

**Risk.** PostgreSQL's default isolation is Read Committed. Two concurrent requests (double click, retry, two staff members) both read the same `_sum`, both pass the balance check, and both insert. The total paid then exceeds the deal amount, which the code elsewhere assumes cannot happen (`summarize`, cashflow "owed", dashboard). Financial integrity issue, not a data leak.

**Likely fix.** Serialize writers per deal by locking the deal row inside the transaction.

```ts
await db.$transaction(async (tx) => {
  await tx.$queryRaw`SELECT id FROM "Deal" WHERE id = ${deal.id} FOR UPDATE`;
  const { _sum } = await tx.payment.aggregate({ where: { dealId: deal.id }, _sum: { amount: true } });
  // ... unchanged
});
```

(Alternative: `{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }` plus a retry on P2034.) The same lock should be taken in `PATCH /api/deals/:id` (finding 3).

**Fix status: fixed.** The payment transaction now locks the deal row (`SELECT … FOR UPDATE`). Reproduced in a throwaway schema: two concurrent 60 payments on a 100 deal both succeeded without the lock (120 paid) and one was rejected with it.

---

## 3. Deal amount and currency can be changed below what is already paid (Medium)

**File:** `src/app/api/deals/[id]/route.ts:29-61`; schema `src/lib/validations/crm.ts:139-169` (`amount` and `currency` are in `dealFields`, so `updateDealSchema` accepts them).

The "total must not drop below what is paid" check only runs when `items` is sent:

```ts
if (items?.length) { ... if (itemsTotal(items) < paid) throw ... }
...
data: { ...body, ... }   // body.amount and body.currency are written unchecked
```

**Risk.** A deal owner can `PATCH {"amount": 1}` after a customer has paid 5,000, producing a negative balance, a wrong "collected vs owed" dashboard, and hiding the shortfall. Changing `currency` after payments exist silently relabels every payment (the cashflow query treats a payment as being in its deal's currency, `src/lib/cashflow.ts:61`). Both are audited, but nothing blocks them. Insider-fraud / data-integrity risk on a system that tracks instalment money.

**Likely fix.** Apply the same guard to `body.amount`, and freeze currency once payments or instalments exist:

```ts
const paid = Number((await db.payment.aggregate({ where: { dealId: params.id }, _sum: { amount: true } }))._sum.amount ?? 0);
const newTotal = items?.length ? itemsTotal(items) : body.amount;
if (newTotal !== undefined && newTotal < paid) throw new ApiError(422, `Amount is less than the ${paid.toFixed(2)} already paid`, "VALIDATION_ERROR", { amount: [...] });
if (body.currency && paid > 0 && body.currency !== existing.currency) throw new ApiError(422, "Currency can't change after payments are recorded", "VALIDATION_ERROR", { currency: [...] });
```

(`existing` must also select `currency`.) Do this inside the same row-locked transaction as finding 2.

**Fix status: fixed.** `PATCH /api/deals/:id` now runs in a transaction with the same row lock and uses `assertDealCoversPayments` (`src/lib/deals.ts`) to refuse a total below the amount paid or a currency change once a payment exists; unit tests in `tests/deal-payments-guard.test.ts`.

---

## 4. Account lockout denial of service (Low)

**Files:** `src/lib/rate-limit.ts:78`, `src/lib/auth.ts:46`, `src/app/api/auth/mfa-check/route.ts:25`.

```ts
signInAccount: { max: 40, windowMs: 60 * 60_000, failClosed: true },   // keyed on email only
[`signin-account:${email}`, LIMITS.signInAccount],
```

**Risk.** The per-account bucket counts every attempt from every IP, and `mfa-check` and `authorize` each increment it before the password is checked. An unauthenticated attacker who knows an admin's email can send 40 requests an hour and keep that admin from signing in indefinitely (magic link is a separate bucket, so a no-MFA user can still recover that way; an MFA user cannot). Trade-off was chosen deliberately to stop distributed guessing, so this is a design risk rather than a bug.

**Likely fix.** (Correction: an earlier draft suggested counting only failed attempts. That does not help, because the attacker's guesses are failures too.) Exempt addresses the account has already signed in from successfully (last 30 days) from the per-account limit; the per-address limits still apply to them.

**Fix status: fixed.** New `signInAllowed` (`src/lib/signin-limits.ts`) is used by both sign-in and `mfa-check`; successful sign-ins record the address (`markKnownIp`, Upstash with 30-day expiry, in-memory in development) and a known address skips only the per-account limit. Residual risk: the real owner on a brand-new address can still be locked out during an attack (password reset or magic link still work); users behind the same shared address as an attacker get up to 60 tries per hour. Unit tests in `tests/signin-limits.test.ts`.

---

## 5. Change-password endpoint: no rate limit, no step-up (Low)

**File:** `src/app/api/me/password/route.ts:26-31`

```ts
if (user.passwordHash) {
  if (!currentPassword || !(await verifyPassword(currentPassword, user.passwordHash))) { return apiError(...400) }
}
```

**Risk.** (a) The route is not wrapped in `authed()`, so it has no rate limit: someone holding a stolen session cookie can guess the current password at bcrypt speed. (b) A session alone is enough to change the password, with no authenticator code, even for users who enabled two-step verification. A hijacked session can therefore lock the real owner out: the new password invalidates every other session via `passwordChangedAt`, and the owner must go through password reset. The attacker still needs the authenticator code to sign in again later, so this is lockout and nuisance rather than full takeover. `me/mfa/disable` already does this properly (rate limit + password + code).

**Likely fix.**

```ts
await enforceRateLimit(`pw-change:${guard.user.id}`, LIMITS.mfa);
...
if (me.mfaEnabledAt && !(await verifyMfaCode(me, body.data.code))) return apiError("Enter a valid code", 400);
```

Add an optional `code` to `changePasswordSchema` and select the MFA fields in the lookup.

**Fix status: fixed.** `POST /api/me/password` now rate limits (10 per 15 minutes per user) and requires an authenticator or recovery code when two-step verification is on (`requireMfaStepUp`); the settings form shows the code field.

---

## 6. Two-step verification is optional, including for ADMIN (Low)

**Files:** `src/lib/auth.ts` (sign-in flow), `src/components/settings/security.tsx`.

Admins can read and edit every contact, deal, payment, invoice and user, and can create further admins, yet can sign in with password only. Magic link (`Nodemailer` provider) also lets anyone who controls the mailbox sign in to a non-MFA account.

**Likely fix.** Require MFA for ADMIN: in the `signIn` callback, refuse a magic link or password sign-in for `role === "ADMIN"` with `mfaEnabledAt === null` and redirect to an enrol-first page; or at minimum show a persistent banner and block `/admin`, `/api/admin` until enrolled. Consider disabling the magic-link provider for ADMIN accounts altogether.

**Fix status: fixed.** Admins without two-step verification now get a Sales-level session (`mfaPending`, `REQUIRE_ADMIN_MFA`, on by default in production) with a banner pointing to Settings → Security; enrolling restores admin access without signing in again (checked in a dev server). Lock-out recovery: `npm run make-admin -- <email> --reset-mfa`. Magic link stays available for admins who have not enrolled yet, and is already refused once they have.

---

## 7. Routes outside `authed()` skip API rate limiting (Low)

**Files:** every `src/app/api/admin/**` and `src/app/api/me/**` route (they call `requireApiUser` directly). `authed()` (`src/lib/route.ts:26`) is where the per-user read/write limit lives.

**Risk.** An admin session (or a hijacked one) can create users and send invite emails without a limit (`POST /api/admin/users`, `/api/admin/users/:id/invite`), and `/api/me/*` writes are unthrottled. Audit entries are still written by hand, so nothing is unlogged.

**Likely fix.** Convert these routes to `authed(handler, "ADMIN")` (they already follow the same error contract), or call `enforceRateLimit` with the `api:w:<userId>` key and `LIMITS.apiWrite` in the guard. Add a small per-admin limit on invites (`sendEmail` bucket).

**Fix status: fixed.** All routes under `src/app/api/admin` and `src/app/api/me` now use `authed()`; invite emails are rate limited per admin; `tests/route-contract.test.ts` fails if a route there skips `authed()`.

---

## 8. CSP permits inline scripts (Low)

**File:** `next.config.mjs:7` — `script-src 'self' 'unsafe-inline'`.

An XSS bug anywhere would not be stopped by the CSP. None was found: React escapes all rendered values, URL fields are restricted to `http(s)` (`src/lib/validations/crm.ts:27-32`), and email HTML is escaped via `esc()`. This is defence in depth only; the comment in the file already documents the reason.

**Likely fix.** Nonce-based CSP from `middleware.ts` (generate a per-request nonce, set `script-src 'self' 'nonce-…' 'strict-dynamic'`, and pass it to Next via the `x-nonce` request header). Keep `style-src 'unsafe-inline'` if Tailwind/Radix need it.

**Fix status: fixed.** The CSP is now built per request in `src/middleware.ts` (`src/lib/csp.ts`): scripts need a fresh nonce with `'strict-dynamic'` and `'unsafe-inline'` is gone from `script-src` (`style-src` keeps it). Checked on a dev server: every one of the 40 to 51 `<script>` tags on the sign-in, dashboard, settings and deals pages carries the nonce and the nonce changes per request. Browser-console behaviour was not checked; `CSP_REPORT_ONLY=1` is available for a trial.

---

## 9. Last-admin guard is incomplete (Low)

**File:** `src/app/api/admin/users/[id]/route.ts:19-24`

```ts
if (params.id === guard.user.id && (demoting || deactivating)) { return apiError(...) }
```

Admin A can demote or deactivate admin B and vice versa; with two admins acting at the same time (or A deactivating B then B's last request landing), zero active admins remain. Recovery needs `npm run make-admin` against the production database.

**Likely fix.** Inside a transaction, when the change demotes or deactivates an admin, count other active admins and refuse if the count is zero:

```ts
if (demoting || deactivating) {
  const others = await tx.user.count({ where: { role: "ADMIN", isActive: true, id: { not: params.id } } });
  if (others === 0) throw new ApiError(400, "At least one active admin must remain");
}
```

**Fix status: fixed.** Demoting or deactivating an admin now runs in a transaction that locks the active admin rows and refuses if no other active admin remains (`wouldLeaveNoAdmin` in `src/lib/access.ts`, unit tested).

---

## 10. MFA encryption key derivation (Info)

**File:** `src/lib/mfa.ts:71-75`. The AES-256-GCM key is `SHA-256("mfa-secret:" + NEXTAUTH_SECRET)`. It is acceptable because the secret is long and random (enforced ≥ 32 chars in production), but it is not a KDF, and rotating `NEXTAUTH_SECRET` makes every stored MFA secret undecryptable (all MFA users locked out, `decryptSecret` throws inside `authorize`).

**Likely fix.** Use a dedicated `MFA_ENCRYPTION_KEY` env var (32 random bytes, base64) validated in `src/lib/env.ts`, or HKDF from the auth secret; document the rotation procedure (admin `mfa-reset` for affected users).

**Fix status: fixed.** Optional `MFA_ENCRYPTION_KEY` (and `MFA_ENCRYPTION_KEY_PREVIOUS` for rotation) with HKDF and a `v2.` format. Legacy secrets keep working and are re-encrypted on the owner's next successful code check. Tests in `tests/mfa-key.test.ts`; procedure in `TECHNICIAN.md`.

---

## 11. Newlines in titles break notification emails (Info)

`sendMail` rejects subjects containing CR/LF (good, this prevents header injection, `src/lib/mail.ts:25`), but task and deal titles are only trimmed (`requiredText`, `src/lib/validations/crm.ts:16`). A task whose title contains a newline makes `taskReminderEmail` throw inside `trySendMail`; the digest for that assignee fails on every cron run and none of their other tasks are reminded. Same for `dealStageEmail`.

**Likely fix.** Strip control characters from the subject when building it (`title.replace(/\s+/g, " ")`) or reject newlines in `title` fields with the same refine used for the email subject.

**Fix status: fixed.** Email subjects built from titles and customer names go through `oneLine()`; tests in `tests/email-subjects.test.ts`.

---

## 12. Informational

- `GET /api/openapi.json` is public by design (`src/lib/rbac.ts:31`). It documents every endpoint to anonymous users; low value to an attacker but consider gating it in production.
- `prisma/seed.ts:36` seeds `admin@crm.test` / `sales@crm.test` / `support@crm.test` with `ChangeMe123!` (or `SEED_USER_PASSWORD`). The script refuses non-local databases (`assertSafeTarget`), which is good; just make sure a shared dev or staging database never receives the seed.
- `docker-compose.yml` uses `crm/crm` credentials but binds to `127.0.0.1` only. Fine for local development.
- The audit log is described as "append-only" (`src/lib/audit.ts`) but nothing in the database enforces it. Consider revoking `UPDATE`/`DELETE` on `"AuditLog"` for the application role.
- Passwords: minimum 10 characters, letter and digit, short denylist (`src/lib/validations/auth.ts`). Consider a breached-password check (HIBP k-anonymity) instead of a hand-made list.

## 13. Multi-instance staleness (Info)

`src/lib/user-cache.ts` caches active users for 30 s per process. On a multi-instance deployment a demotion or deactivation can take up to 30 s to apply on other instances (already documented in the file). Acceptable; shorten the TTL or use Redis if immediate revocation is needed.

**Fix status: fixed.** `/api/openapi.json` now needs a session. Migration `20261012000000_audit_log_append_only` adds triggers that refuse `UPDATE`, `DELETE` and `TRUNCATE` on `"AuditLog"` (tested in a throwaway schema; apply with `npm run db:deploy`, retention procedure in `TECHNICIAN.md`). Seed credentials and docker-compose were left as they are, and a breached-password check was deliberately not added.

**Fix status: fixed.** Documented in `HANDOVER.md` and `TECHNICIAN.md`; no code change.

---

## Re-scan of the fixes (findings 14 and 15)

Re-reading the changes from findings 1 to 13 found two problems the fixes themselves introduced or left open.

- **14. `safeRedirect` open redirect.** The tab/newline fix returned the parsed path, and dot-segments collapse when parsed: `/.//evil.com` became `//evil.com`, which a browser reads as another site. The sign-in page redirected signed-in users there. **Fix status: fixed.** A result starting with `//` is refused; tests cover the dot-segment forms.
- **15. Stale deal values read before the row lock.** Recording a payment used the deal amount read before taking the lock, so a concurrent edit that lowered the amount could still be overpaid; the deal edit did the same with the currency. **Fix status: fixed.** Both now re-read the deal under the lock (and refuse a deal deleted in the meantime). The admin lock query also locks in id order so two concurrent demotions cannot deadlock.

---

## Review of newer features (2026-10-22): findings 16 and 17

Second pass over the features added after the first audit (website form, Stripe payment links and webhook, two-way WhatsApp, email templates, tags and saved views, exports). No Critical or High findings; `npm audit --omit=dev` reports 0 vulnerabilities. Two Low/Info items were fixed after the owner approved a plan; three more were noted without code changes (below).

- **16. Anyone can add text to an existing contact through the public website form (Low).** `src/lib/web-lead.ts`: a known email address adds a note to that contact and emails the owner the submitted text. The form answers the same "thanks" for everyone, so an attacker only needs a customer's email address to put their own text in front of staff. **Fix status: fixed.** Notes added to an existing contact start with `[Unverified website form submission]`. The owner's email names the stored contact (not the typed name), leaves out the typed phone and email, and shows only the first 100 characters of the message, on one line and marked unverified. New enquiries are unchanged. Tests in `tests/web-lead.test.ts`.
- **17. Payment-link redirect base could come from the Host header (Info).** `src/app/api/deals/[id]/payment-links/route.ts` fell back to `new URL(req.url).origin` when `NEXTAUTH_URL` was unset (production requires it, so this affected misconfigured self-hosting only). **Fix status: fixed.** The route now uses `appUrl()`. In development without `NEXTAUTH_URL` the redirect points to port 3000. Test in `tests/payment-link-route.test.ts`.

Noted, no code change: the website form's overall hourly limit (200) can be used up by one rotating-address bot, which would block real visitors (a log line now warns when it is reached; consider a CAPTCHA); requests without an `Origin` header skip the form's origin allowlist by design and are held only by the address limit; the Stripe and WhatsApp webhooks check signatures first but have no request-rate cap (limit them at the proxy or WAF).

---

## Review of the multi-business features (2026-11-01): findings 18 to 20

Read-only review of the public and unauthenticated surface added with multi-tenancy, billing, WhatsApp and campaigns. No Critical or High findings; no cross-business access found. Three Low/Info items, fixed after the owner approved a plan (branch `security-fixes-18-20`).

- **18. Public webhooks did database work before the signature check, with no rate limit (Low).** `src/lib/stripe-webhook.ts`, `src/lib/whatsapp-webhook.ts`. Each unsigned request read and decrypted the business's settings, and an unconfigured business answered 503 while a configured one answered 400/401, which showed which business ids use Stripe or WhatsApp. **Fix status: fixed.** `webhookThrottle` (`LIMITS.webhookIp`, 300 per minute per address and webhook kind, fails open) runs before any lookup on the Stripe, WhatsApp and billing webhooks. An unconfigured business now answers exactly like a bad signature (400 Stripe, 401 WhatsApp POST, 403 for Meta's check). Tests: `tests/webhook-throttle.test.ts`.
- **19. Client IP depends on proxy settings (Low).** `src/lib/rate-limit.ts` (`clientIp`). With a wrong or unset `TRUSTED_PROXY_COUNT`, or an app reachable without its proxy, `X-Forwarded-For` can be forged to dodge every address-based limit; a chain shorter than the proxy count silently used the leftmost (client-controlled) entry. **Fix status: fixed.** A short chain now uses the rightmost entry and logs once; `TRUSTED_PROXY_COUNT` must be a whole number from 1 to 99 or production start-up fails; start-up warns (does not stop) when it is unset off Vercel. Deployment check added to the README. The setting itself still has to be right for the host. Tests: `tests/client-ip.test.ts`.
- **20. Signup confirmation link in the response gated only by `NODE_ENV` (Info).** `src/app/api/signup/route.ts`, `src/lib/signup.ts`. Not exploitable as deployed (production ran the signup after the response and dropped the result), but one misconfigured environment would have let anyone confirm a signup for an email they do not own. **Fix status: fixed.** The link is returned only with `SIGNUP_DEV_LINKS=1` and console-only mail; production start-up refuses to boot with the flag set. Tests: `tests/signup-dev-link.test.ts`.

Not changed: the admin invite route also returns a development link, but only to a signed-in admin.

---

## Data export feature (added 2026-10-20)

New feature, reviewed as it was built. Nothing here was a finding in the original audit; this records the design and the risks it was built against.

**What it adds:** CSV exports of 11 areas, two PDFs (deal statement, supplier invoice), admin-only exports of contacts and the audit log, an admin-only export of soft-deleted records, and an admin-only zip of everything. Routes: `src/app/api/export/**`; code: `src/lib/export/**`.

| Risk | How it is handled |
| --- | --- |
| Reading other people's data | Every area uses the same scope helpers as its list screen (`ownerScope`, `authorScope`, `taskScope`, `liveFilter`); the scope is its own `AND` clause, so a URL filter such as `ownerId` can only narrow it. PDFs look the record up with `ownerScope`. Tests assert the `where` for a SALES user and an admin on each scoped area. |
| Mass leak of personal data | Contacts and the audit log are admin-only (403 for everyone else; unknown names 404, including `constructor`/`__proto__`). In every other file a customer is a name only. Audit-log export, deleted records and the full export need a fresh authenticator code. 5 exports per user per 10 minutes, 50,000 rows per file (full export: 500,000, refused rather than truncated). |
| Secrets in a file | Entities `select` explicit fields only, so new columns cannot leak; no code path reads `User`, `Account`, `Session` or `VerificationToken`. A test scans `src/lib/export` and `src/app/api/export` for secret field names and for `include:`. |
| Spreadsheet formula injection | Text cells starting `=`, `+`, `-`, `@`, tab, CR or LF (after optional leading whitespace) get a leading `'`; numbers are written as numbers. |
| PDF content injection | pdfkit draws plain text only; control characters are stripped; values are cut to the cell width; fonts embedded (no font fallbacks to attacker-chosen names). The file name in `Content-Disposition` is built from a fixed list and the date (CSV) or from a sanitised title/number (PDF). Invoice PDFs omit resale prices. |
| No trace of who took what | An `EXPORT` row (actor, entity, format, rows, filters, IP) is written before the first byte; a failed write fails the export. The audit table is append-only (triggers). |
| Code reuse / brute force of the code | Codes are single-use (`mfaLastStep`), attempts use the existing `LIMITS.mfa` bucket, and the code is checked only after the cheap refusals so it is not spent on a doomed request. A code in the POST body, never in a URL. |
| CSRF | State-changing exports are POST and pass through the existing Origin check; GET exports are read-only and `no-store`. |
| Resource exhaustion | Rows are counted first and refused over the cap; data streams in batches of 500; zips are compressed as they are produced. |

**New dependencies** (checked with `npm view` and `npm audit --omit=dev`, 0 vulnerabilities): `pdfkit` 0.20.2 (MIT, maintained), `fflate` 0.8.3 (MIT, no dependencies; already present via `read-excel-file`), `@expo-google-fonts/noto-sans` 0.4.2 (MIT and OFL, font files only), `@types/pdfkit` (dev). The 7 high findings in a full `npm audit` are existing dev-only packages (`braces` via Tailwind and ESLint), not from these.

**Residual risks:**
- Anyone who may export can still copy their own data out; the audit record and the limit deter it but cannot stop it.
- An admin without two-step verification is not asked for a code. `REQUIRE_ADMIN_MFA` (on by default in production) closes this.
- Exported files are outside the app's control; documented advice is to store the zip encrypted.
- The export limit is counted from the audit log and is not atomic; two requests at the same instant can both pass.
- Filter logic is duplicated from the list routes (`src/lib/export/entities.ts`); a change to a list filter needs the same change there.
- Free-text notes (activities, tasks, payment references, invoice `billTo`) are exported as written and can contain contact details.
- PDF layout was checked by building a production bundle and generating sample files, not by viewing them in a PDF reader.

## Verified as sound (no action)

- **Authentication:** bcrypt cost 12; dummy hash for unknown users (no timing oracle); generic failures; reset tokens are random 256-bit, stored hashed, single use, 1 h TTL; password reset and change set `passwordChangedAt`, which the `jwt` callback uses to kill older sessions; deactivated users rejected on every request; magic link blocked for MFA accounts.
- **MFA:** TOTP with replay protection (`mfaLastStep` updated atomically), constant-time compare, recovery codes hashed and consumed atomically, enable/disable rate limited, secret encrypted at rest.
- **Authorisation:** every data route scopes by `ownerScope` / `authorScope` / `taskScope`; linked records re-checked with `assertLinks` / `assertDealIds`; owner reassignment limited to admins; restore endpoints are ADMIN-only; `/api/admin` guarded in middleware **and** in each handler.
- **CSRF:** SameSite=Lax cookies, Origin check on state-changing API calls, JSON-only bodies, no CORS headers.
- **Injection:** parameterised Prisma queries; raw SQL only through tagged templates; sort fields are Zod enums; page size capped at 100; request body capped at 1 MB.
- **Secrets and config:** none committed; `assertProductionEnv` enforces secret length, cron secret, mail provider and Redis at startup; cron endpoint uses constant-time bearer comparison and fails closed.
- **Headers:** HSTS, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `no-store` on `/api/*`.
- **Dependencies:** `npm audit --omit=dev` reports 0 vulnerabilities.
- **Client import:** spreadsheet parsing runs in the browser, 5 MB cap, 500-row cap, and the result still passes server-side Zod validation.

## Recommended next steps

1. Get owner approval for a fix plan, then in this order: #1 (`safeRedirect` + tests), #2 and #3 (deal row lock, amount/currency guard, tests that fire two payments concurrently), #5, #7, #6.
2. Add regression tests: `safeRedirect` control characters; concurrent payments; `PATCH /api/deals/:id` with `amount` below paid; last-admin demotion.
3. Add `npm audit --omit=dev` and a secret scanner (gitleaks) to `.github/workflows/ci.yml`; enable Dependabot or Renovate.
4. Enforce MFA for ADMIN accounts and consider removing magic-link sign-in for them.
5. Move to a nonce-based CSP.
6. Production checklist: set `UPSTASH_*`, `CRON_SECRET`, `TRUSTED_PROXY_COUNT` (self-hosting: the app must not be reachable except through the proxy, otherwise `X-Forwarded-For` can be forged and rate limits evaded), a restricted database role without `DELETE` on `"AuditLog"`, and database backups with a tested restore.
7. Re-run this review after the fixes, and consider a short external penetration test before holding real customer payment data at scale.
