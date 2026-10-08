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
`DATABASE_URL`, `DIRECT_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `SEED_USER_PASSWORD` (dev), `RESEND_API_KEY` or `EMAIL_SERVER`, `EMAIL_FROM`, `CRON_SECRET` (production), `AUTH_TRUST_HOST` (self-host), `TRUSTED_PROXY_COUNT` (self-host, default 1), optional `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`.

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

## Users
There is no public sign-up: admins create users in Settings → Team (`POST /api/admin/users`), and the invitee sets a password from the emailed link (valid 7 days). Change roles with `PATCH /api/admin/users/:id` (admin), `npm run make-admin`, or Prisma Studio. Role changes, deactivation and password resets take effect immediately on the server that handled the change, and within 30 seconds on any other instance (user lookups are cached for 30 s in `src/lib/user-cache.ts`).

## Security features (where they live)
- **Audit log:** `src/lib/audit.ts`. `authed()` (`src/lib/route.ts`) logs every successful write automatically; routes that delete money records call `audit()` themselves with a snapshot. Viewer: Settings → Audit log (`GET /api/admin/audit`).
- **Two-step verification:** `src/lib/mfa.ts` (TOTP, encryption, recovery codes), `src/lib/mfa-server.ts` (verification), `/api/me/mfa/*`, `/api/auth/mfa-check`. A user who lost their phone: Settings → Team → Edit → "Reset two-step verification". **Admin enforcement:** `adminMfaRequired()` / `mfaPending()` in `src/lib/rbac.ts` (env `REQUIRE_ADMIN_MFA`, default on in production). The Auth.js `jwt` callback sets `token.mfaPending` from the database on every full session read and the `session` callback downgrades the role to SALES, so server code and pages see a non-admin; the edge middleware keeps the real role (it has no database) and is only the coarse gate. Lock-out recovery: `npm run make-admin -- <email> --reset-mfa`.
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
