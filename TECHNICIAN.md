# Technician Guide (system support)

## Stack
Next.js 14 (App Router) + TypeScript, Tailwind + shadcn/ui, TanStack Query, Prisma 6 on PostgreSQL, Auth.js v5, zod, Vercel hosting, Resend email. More detail in `README.md`.

## Folder map
| Path | What |
|---|---|
| `src/app/(app)/` | Pages (dashboard, contacts, companies, deals, invoices, stock, tasks, activities, settings) |
| `src/app/api/` | REST API (also `openapi.json`) |
| `src/lib/` | Server logic: `payments.ts`, `cashflow.ts`, `stock.ts`, `invoices.ts`, `deals.ts`, `money.ts`, `notifications.ts`, `access.ts` |
| `src/lib/client/` | Browser helpers: types, hooks, format, `invoice-import.ts` |
| `src/lib/validations/crm.ts` | Input validation (zod) |
| `prisma/` | `schema.prisma`, `migrations/`, `seed.ts`, `sample-invoice.ts` |
| `scripts/make-admin.ts` | Promote a user to admin |

## Environment variables (names only; see `.env.example`)
`DATABASE_URL`, `DIRECT_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `SEED_USER_PASSWORD` (dev), `RESEND_API_KEY` or `EMAIL_SERVER`, `EMAIL_FROM`, `CRON_SECRET` (production), `AUTH_TRUST_HOST` (self-host), `TRUSTED_PROXY_COUNT` (self-host, default 1), optional `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`, optional `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` (both or neither; see "Online payments" below), optional `DEFAULT_PHONE_COUNTRY_CODE` (digits, e.g. `234`; lets numbers written as `0803…` get a WhatsApp button).

## Online payments (Stripe)
Payment links are Stripe Payment Links (one payment each, USD and EUR only). The CRM never sees card details.
1. Use **test mode** first. Create a restricted key (`rk_test_…`) that can write *Payment Links*, or a `sk_test_…` key, and put it in `.env` as `STRIPE_SECRET_KEY`.
2. Locally: `stripe listen --forward-to localhost:3001/api/webhooks/stripe` prints a `whsec_…` secret; put it in `.env` as `STRIPE_WEBHOOK_SECRET` and restart the dev server.
3. In production: in the Stripe dashboard add the endpoint `https://<your-domain>/api/webhooks/stripe` for the events `checkout.session.completed` and `checkout.session.async_payment_succeeded`, and use its signing secret. Switch to live keys only after one real small payment works.
4. `NEXTAUTH_URL` is used for the "thank you" page address (`/pay/result`); outside Vercel it must be your public https URL.
- The webhook (`/api/webhooks/stripe`) is public and protected only by Stripe's signature. A bad signature gets 400; a processing failure gets 500 so Stripe retries. Recording is idempotent (unique `Payment.providerRef`).
- Every online event is in the audit log (`payment.recorded_online`, `payment.online_refund_needed`, `payment_link.created`, `payment_link.cancelled`).
- A payment that can't be recorded (balance dropped, link cancelled, deal deleted) is never dropped silently: link status `REFUND_NEEDED` plus an URGENT task for the deal owner.
- Test cards: `4242 4242 4242 4242`, any future date, any CVC.

## Commands
| Command | Use |
|---|---|
| `npm install` | Install (also generates the Prisma client) |
| `docker compose up -d` | Optional local Postgres |
| `npm run db:push` | Sync schema to the **dev** database |
| `npm run db:deploy` | Apply migrations (production) |
| `npm run db:seed` | **Wipes data**, loads samples. Dev only |
| `npm run dev` | Dev server on http://localhost:3001 |
| `npm run typecheck`, `npm run lint`, `npm run build` | Checks |
| `npm run make-admin -- you@example.com` | Promote an existing user to admin |
| `npm run db:studio` | Browse the database |

### Fast (production-mode) launcher for local use
`start-crm-fast.bat` runs `next build` then `next start` on `CRM_PORT` (default 3001; `CRM_NO_BROWSER=1` skips opening the browser). `scripts/needs-build.ps1` decides whether to rebuild: it compares a marker (`.next\fast-build-done`, written after a successful build) with the source files, and with anything else written into `.next` since, because **the dev server and the build share the `.next` folder** (running `npm run dev` replaces the production files, so the next fast start rebuilds). Never run `next build` while the dev server is up: it overwrites its files. The launcher refuses to start if the port is busy.
It sets `AUTH_TRUST_HOST=true`, `NEXTAUTH_URL=http://localhost:<port>` and `SKIP_ENV_VALIDATION=1` (the startup check in `src/lib/env.ts` is for public deployments and wants Redis, a mail provider and `CRON_SECRET`). Consequences of `NODE_ENV=production`: admins without two-step verification get the Sales-level session (`REQUIRE_ADMIN_MFA` defaults on), `sendMail` throws without `RESEND_API_KEY`/`EMAIL_SERVER` (no console fallback, so invitations and resets fail with a warning), rate limits are in memory. Measured on the seed data (local database): pages 340-500 ms in dev vs 53-64 ms built; APIs 77-117 ms vs 17-48 ms; about 210 KB of compressed JS and CSS per page.

Migrations are hand-written SQL in `prisma/migrations/`. When you change `schema.prisma`, add a matching migration folder, then restart the dev server.

## Deployment (Vercel)
1. Set the environment variables above in the Vercel project.
2. Build runs `npm run vercel-build` (applies migrations, then builds).
3. `vercel.json` schedules `/api/cron/task-reminders` daily at 08:00 UTC. It needs `Authorization: Bearer <CRON_SECRET>` and sends task and instalment reminders.
4. Check `/api/health` after deploy.

## Troubleshooting
| Symptom | Cause / fix |
|---|---|
| 500 "Unknown field …" or missing new data after a schema change | Stale Prisma client. Run `npx prisma generate` and restart `npm run dev` |
| No emails arrive | No provider set. In dev, emails print to the server console. In production set `RESEND_API_KEY` and a verified `EMAIL_FROM` |
| Reminders never run | `CRON_SECRET` missing or wrong, or cron not enabled on Vercel |
| Invoice import "does nothing" | Invoice number, supplier or billed-to is empty. The error banner is at the top of the form |
| Stock shows items as unmatched | Product, colour and length must match the invoice line (not case-sensitive) |
| A user sees no records | Records are owner-scoped. Only admins see all |
| Data suddenly gone | Someone ran `db:seed` or `db:reset`. Restore from backup |
| Cannot sign in after deploy | Check `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `AUTH_TRUST_HOST` |

## Backup and restore (PostgreSQL)
- Backup: `pg_dump "$DIRECT_URL" -Fc -f crm.dump`
- Restore into an empty database: `pg_restore -d "<url>" --clean crm.dump`
- Back up before any migration and before deleting sample data. Hosted providers (Neon, Supabase) also offer point-in-time restore.

## Data export (CSV, PDF, zip)
Not a backup: `pg_dump` (above) is the only way to restore. Exports are for reading, reporting and keeping a readable copy.
- **Where it lives:** `src/lib/export/` (`entities.ts` and `admin-entities.ts` list each area's fields; `registry.ts` is the URL-name list; `run.ts` has the permission, limit, code and audit order; `csv.ts`, `stream.ts`, `zip.ts`, `pdf.ts`), routes in `src/app/api/export/`, UI in `src/components/export/` and Settings → Data export. API shapes are in `/api/openapi.json` under "Export".
- **Add a field or area:** add the field to the `select` and to the `columns` of its entity, and nowhere else. Entities select explicit fields only (a test fails on `include:` or on any secret field name). The contacts table and the audit log stay in `admin-entities.ts`; add `adminOnly` (and `stepUp` if it should ask for a code) to any new sensitive area.
- **Fonts and PDF:** `pdfkit` draws the PDFs and embeds Noto Sans from `node_modules/@expo-google-fonts/noto-sans` (path built from `process.cwd()`), so the app must start from the project folder and `node_modules` must be present at run time. If PDFs fail with "ENOENT" on a font file, that is why. pdfkit is loaded as an external package, not bundled.
- **Limits (constants in `src/lib/export/limits.ts`):** 50,000 rows per CSV, 2,000 lines per PDF, 500,000 rows per file in the full export, 5 exports per user per 10 minutes. The per-user limit is counted from `AuditLog` rows with action `EXPORT`, so it works without Redis and survives restarts. It is not atomic, so two requests at the same moment can both pass.
- **Audit:** every export writes an `EXPORT` row (actor, entity, format, row count, filters, IP) before any data is sent. If that write fails, the export fails. Review them in Settings → Audit log (search "EXPORT").
- **Authenticator code:** the audit-log export, deleted records and the full export need a fresh TOTP or recovery code when the admin has two-step verification on (same helper as password change: `requireMfaStepUp`). An admin without it set up is not asked, so keep `REQUIRE_ADMIN_MFA` on in production.
- **Self-hosting:** the per-user limit does not depend on the client IP, but the other rate limits do, so set `TRUSTED_PROXY_COUNT` correctly and keep the app reachable only through the proxy. Large exports stream, but a reverse proxy with a short timeout or response buffering (nginx `proxy_buffering`, `proxy_read_timeout`) can cut a big download short: raise the timeout for `/api/export/`.
- **Troubleshooting:** 422 `EXPORT_TOO_LARGE` means narrow the filters (or use `pg_dump`); 429 means the 5-per-10-minutes limit; 422 `STEP_UP_REQUIRED` means a code is needed and the call must be a POST; 400 "That code is not right" means the code was wrong or already used.

## Users
There is no public sign-up: admins create users in Settings → Team (`POST /api/admin/users`), and the invitee sets a password from the emailed link (valid 7 days). Change roles with `PATCH /api/admin/users/:id` (admin), `npm run make-admin`, or Prisma Studio. Role changes, deactivation and password resets take effect immediately on the server that handled the change, and within 30 seconds on any other instance (user lookups are cached for 30 s in `src/lib/user-cache.ts`).

## Security features (where they live)
- **Audit log:** `src/lib/audit.ts`. `authed()` (`src/lib/route.ts`) logs every successful write automatically; routes that delete money records call `audit()` themselves with a snapshot. Viewer: Settings → Audit log (`GET /api/admin/audit`). The table is append-only in the database itself: migration `20261012000000_audit_log_append_only` adds triggers that refuse `UPDATE`, `DELETE` and `TRUNCATE`. To purge old rows on purpose (retention), drop the two triggers named in that migration, delete, then recreate them. In production also run the app as a database role without those privileges (`REVOKE UPDATE, DELETE, TRUNCATE ON "AuditLog" FROM <app_role>;`) so it is enforced twice.
- **Two-step verification:** `src/lib/mfa.ts` (TOTP, encryption, recovery codes), `src/lib/mfa-server.ts` (verification), `/api/me/mfa/*`, `/api/auth/mfa-check`. A user who lost their phone: Settings → Team → Edit → "Reset two-step verification". **Admin enforcement:** `adminMfaRequired()` / `mfaPending()` in `src/lib/rbac.ts` (env `REQUIRE_ADMIN_MFA`, default on in production). The Auth.js `jwt` callback sets `token.mfaPending` from the database on every full session read and the `session` callback downgrades the role to SALES, so server code and pages see a non-admin; the edge middleware keeps the real role (it has no database) and is only the coarse gate. Lock-out recovery: `npm run make-admin -- <email> --reset-mfa`. **Encryption key:** without `MFA_ENCRYPTION_KEY` the secrets are encrypted with a key derived from `NEXTAUTH_SECRET`, so changing that secret makes every stored two-step secret unreadable. Set `MFA_ENCRYPTION_KEY` (`openssl rand -base64 32`) to decouple them: existing secrets keep working and are re-encrypted the next time their owner signs in with a code. To rotate, move the old value to `MFA_ENCRYPTION_KEY_PREVIOUS`, set a new `MFA_ENCRYPTION_KEY`, and remove the previous one once everyone with two-step verification has signed in once.
- **Content Security Policy:** built per request in `src/middleware.ts` from `src/lib/csp.ts`: scripts run only with a fresh nonce (`'strict-dynamic'`, no `'unsafe-inline'`); the root layout passes the nonce from the `x-nonce` header to next-themes. Pages are therefore rendered per request. A new inline `<script>` must take the nonce too. `CSP_REPORT_ONLY=1` switches to report-only (violations show in the browser console, nothing is blocked). API responses carry no CSP.
- **Role and deactivation lag:** every request re-checks the user against the database, but active users are cached in memory for 30 s (`src/lib/user-cache.ts`). A change made on one server instance applies there at once; on a multi-instance deployment other instances can keep the old role or active flag for up to 30 s. Lower the `USER_CACHE_TTL_MS` constant in that file if that is too long.
- **Sign out everywhere:** sets `User.passwordChangedAt` to the next whole second (`src/lib/sessions.ts`); the `jwt` callback rejects older tokens. A login within that second after a revoke is also refused.
- **Rate limits:** `src/lib/rate-limit.ts` (`LIMITS`). Client IP comes from the right of `X-Forwarded-For` (`TRUSTED_PROXY_COUNT`).
- Route handlers without a URL segment receive no `params` in Next 15; `authed()` handles that.

## Support checklist
1. Reproduce it and note the page and user.
2. Check the server logs (Vercel logs or dev console).
3. Check `/api/health` and the environment variables.
4. Run `npm run typecheck` if code changed.
5. Back up before any data fix. Never fix by seeding.
6. Escalate with: steps, user, time, log lines, screenshots.
