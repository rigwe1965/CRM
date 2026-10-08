# CRM

A modern full-stack CRM. Includes authentication, the REST API, the web app, transactional email and a production setup for Vercel. Deploying? Jump to [Deploy to production](#deploy-to-production).

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind CSS + shadcn/ui (Radix)
- TanStack Query (data fetching, optimistic updates), Recharts, dnd-kit (Kanban), Sonner (toasts)
- PostgreSQL + Prisma 6
- Zod for validation
- Auth.js v5 (`next-auth@beta`) with the Prisma adapter and JWT sessions
- Resend for email (Nodemailer/SMTP fallback), deployed on Vercel

## Authentication

- **Pages:** `/sign-in`, `/forgot-password`, `/reset-password`, `/verify-request`, `/profile`, `/unauthorized`
- **Methods:** email + password, or a magic link ("Use a magic link instead" on the sign-in page). Users can turn on **two-step verification** (authenticator app) in Settings → Security; their sign-in then also asks for a 6-digit code (or a one-time recovery code), and magic links are switched off for that account. Admins can reset a user's two-step setup or sign them out everywhere from Settings → Team → Edit.
- **Roles:** `ADMIN`, `SALES`, `SUPPORT`. `ADMIN` passes every role check. There is no public sign-up: admins create users with `POST /api/admin/users` (Settings → Team) and change roles with `PATCH /api/admin/users/:id`. The seed creates an admin.
- **Route protection:** `src/middleware.ts` is a coarse JWT-based gate (everything is private except the public paths in `src/lib/rbac.ts`). Role-restricted prefixes (`/admin`, `/api/admin`) are listed in the same file. Pages and handlers re-check against the database with the helpers below.
- **Server helpers** (`src/lib/auth-helpers.ts`):
  - `getCurrentUser()`
  - `requireUser()` and `requireRole("ADMIN")` for pages (redirect)
  - `requireApiUser("SALES")` for route handlers (returns 401/403 responses)
- **Sessions:** JWT cookies (30 days). Each session read re-checks the user in the database, so deactivating a user or changing their role takes effect immediately. Changing or resetting a password, or "Sign out everywhere" (Settings → Security), signs out all existing sessions.
- **Passwords:** at least 10 characters with a letter and a number; common passwords and obvious sequences are refused.
- **Audit log:** every sign-in (and failed one), account change and write is recorded in the `AuditLog` table and shown to admins in Settings → Audit log. Deleting an invoice, payment, stock adjustment, task or activity keeps a full snapshot of it in the log. The log is append-only through the app; there is no retention job, so prune old rows yourself if it grows large.
- **Password reset:** one-hour, single-use token. Only its SHA-256 hash is stored (in the `VerificationToken` table). The forgot-password endpoint never reveals whether an email is registered.
- **Email:** see [Email](#email). With no provider configured in development, links are printed to the **server console**.
- **Self-hosting:** set `AUTH_TRUST_HOST=true` when using `next start` behind your own domain.
- **Rate limiting:** sign-in, forgot/reset password, magic links and contact emails are throttled (see the [Security checklist](#security-checklist)). Self-service sign-up is disabled.

## Web app

Sign in at `/sign-in` (seeded users are listed above). Pages:

| Page | What it does |
| --- | --- |
| `/dashboard` | Pipeline value, 30-day wins and win rate, contacts and task counts, pipeline and contact-type charts, recent activity, upcoming tasks |
| `/contacts`, `/contacts/:id` | Searchable, filterable, sortable list. The detail page has the activity timeline, deals and tasks, and a "Convert to customer" button. |
| `/companies`, `/companies/:id` | Companies with their contacts, deals and activity |
| `/deals` | Kanban pipeline: drag a card between stages (or use its menu, which also works on touch and keyboard). Moving to Lost asks for a reason. |
| `/tasks` | Open / Overdue / Completed views, priority filter, tick tasks off |
| `/activities` | Searchable log of calls, emails, meetings and notes |
| `/settings` | Profile, password and, for admins, team roles and deactivation. `/profile` redirects here. |

Notes on the UI:
- Everything talks to the REST API below through `src/lib/client` (typed fetch wrapper and TanStack Query hooks). Deal moves and task check-offs update instantly and roll back with an error toast if the server rejects them.
- Components live in `src/components`: `ui/` (shadcn primitives, written by hand because the shadcn CLI is interactive), `forms/` (create/edit dialogs), `common/` (page header, empty and error states, skeletons, pagination, pickers) and `layout/` (app shell).
- Light and dark themes (`next-themes`, class-based). It follows your OS setting until you pick Light, Dark or System from the sun/moon button in the top bar (also on the sign-in pages); the choice is remembered in the browser. Colors are CSS variables in `src/app/globals.css`, so use the semantic classes (`bg-card`, `text-muted-foreground`, …) rather than fixed colors in new UI.
- Company and contact pickers load the first 100 records alphabetically, and the deal board shows the 100 most recently updated deals (search narrows it). Both are the first things to change if you expect much larger data.

## REST API

All endpoints live under `/api`, return JSON and need a signed-in session (cookie). The machine-readable spec is generated from the same Zod schemas the handlers validate with: **`GET /api/openapi.json`** (OpenAPI 3.1; import it into Swagger UI, Postman or Insomnia).

| Resource | Endpoints |
| --- | --- |
| Organizations | `GET/POST /api/organizations`, `GET/PATCH/DELETE /api/organizations/:id`, `POST …/:id/restore` (admin) |
| Contacts (leads, customers) | `GET/POST /api/contacts`, `GET/PATCH/DELETE /api/contacts/:id`, `POST …/:id/convert`, `POST …/:id/email`, `POST …/:id/restore` (admin) |
| Deals | `GET/POST /api/deals`, `GET/PATCH/DELETE /api/deals/:id`, `POST …/:id/stage`, `POST …/:id/restore` (admin), `GET /api/deals/pipeline` |
| Activities | `GET/POST /api/activities`, `GET/PATCH/DELETE /api/activities/:id` |
| Tasks | `GET/POST /api/tasks`, `GET/PATCH/DELETE /api/tasks/:id` |
| Dashboard | `GET /api/dashboard` (counts, pipeline value, revenue and win rate, recent activity, upcoming tasks) |

Conventions:
- **Responses:** `{ "data": … }`, and lists add `"meta": { page, pageSize, total, totalPages }`. Errors are `{ "error": "message", "code": "NOT_FOUND", "fieldErrors"?: { "field": ["msg"] } }` with 400/401/403/404/409/422 status codes. Deletes return 204.
- **Lists:** `page`, `pageSize` (max 100), `sort`, `order`, `q` (text search) plus resource filters, for example `GET /api/deals?stage=PROPOSAL,NEGOTIATION&minAmount=10000&sort=amount&order=desc`. Unknown sort fields are rejected with 422.
- **Authorization:** non-admins only see and edit their own data: organizations, contacts and deals they own, activities they authored, and tasks assigned to or created by them. They can't assign records to other users or link records to data they don't own. Admins see everything. SALES and SUPPORT have the same scope.
- **Soft delete:** organizations, contacts and deals get `deletedAt` and vanish from the API. Admins can list them with `includeDeleted=true` and restore them. Activities and tasks are hard-deleted. A soft-deleted contact still holds its unique email (and an organization its domain), so creating a duplicate returns 409 until an admin restores or edits the original.
- **Deals:** moving a deal sets its probability from the stage (10/25/50/75/100/0). Closing sets `closedAt`, and reopening clears `closedAt` and `lostReason`. An explicit `probability` in the same request wins. Amounts are JSON numbers rounded to cents, and dashboard totals assume one currency.
- **Where the code is:** handlers are in `src/app/api/**/route.ts` and wrapped with `authed()` (`src/lib/route.ts`). Ownership rules are in `src/lib/access.ts`, schemas in `src/lib/validations/crm.ts` and the OpenAPI operation table in `src/lib/openapi.ts`.

Database changes: this repo now includes the initial migration (`prisma/migrations`), so `npm run db:migrate` applies the whole schema, including `User.passwordChangedAt` and the `deletedAt` columns.

## Email

All mail goes through `src/lib/mail.ts`, which picks a provider from the environment: **Resend** (`RESEND_API_KEY`, preferred) → **SMTP** via Nodemailer (`EMAIL_SERVER`) → **console** in development. Production refuses to start without one of the first two.

| Email | When | Recipient |
| --- | --- | --- |
| Invitation | When an admin creates a user | The new user |
| Password reset | `POST /api/password/forgot` (one-hour, single-use link) | The account owner |
| Magic link | Sign in with a link | The user |
| Deal stage change | A deal moves stage (drag, menu, `PATCH` or `POST …/stage`) | The deal owner, plus all active admins when it is closed won or lost. The person who made the change is never emailed. |
| Task reminders | Daily cron, `GET /api/cron/task-reminders` | Each assignee gets one digest of open tasks that are overdue or due within 24 hours. Each task is reminded once; changing its due date or assignee re-arms it. |
| Email a contact | **Send email** on a contact page, or `POST /api/contacts/:id/email` | The contact. `Reply-To` is you, and the email is logged as an EMAIL activity. |

Notes:
- Delivery failures never fail the action that triggered them (a stage change still succeeds); they are logged as `[mail] failed to send …`. Emailing a contact is the exception: you get an error, because sending was the whole point.
- Set `EMAIL_FROM` to an address on a domain you have **verified in Resend** (DNS records). Resend's `onboarding@resend.dev` test sender only delivers to your own account email.
- Contact emails are sent from `"Your Name via CRM" <EMAIL_FROM address>` with your address as Reply-To. The sender address is never spoofed, so SPF/DKIM stay aligned.
- Reminders run once a day (`0 8 * * *` UTC in `vercel.json`; Vercel's Hobby plan only allows daily crons). On a Pro plan or any other scheduler you can run it hourly: the endpoint is idempotent. Trigger it manually with `curl -H "Authorization: Bearer $CRON_SECRET" https://your-app/api/cron/task-reminders`.
- Templates live in `src/lib/email-templates.ts`; every interpolated value is HTML-escaped.
- Gotcha worth knowing: Next.js caches identical `POST` fetches made from `GET` route handlers. The cron route sets `fetchCache = "force-no-store"` so a repeated, identical email is never swallowed. Keep that line if you add other mail-sending `GET` handlers.

## Deploy to production

Recommended: **Vercel** (app + cron) with a hosted **Postgres** (Neon, Supabase or Vercel Postgres) and **Resend** (email). Any Node host also works; see "Self-hosting" below.

### 1. Services

1. **Database.** Create a Postgres database. With a pooled provider (Neon, Supabase) you get two URLs: the **pooled** one for `DATABASE_URL` and the **direct** one for `DIRECT_URL` (migrations need a direct connection). With plain Postgres, use the same URL for both. Put the database in the same region as your Vercel functions.
2. **Resend.** Create an API key and verify your sending domain (Domains → add the DNS records). Wait until it shows *Verified*.
3. **Upstash Redis** (free tier, required in production) so rate limits are shared across serverless instances. Copy its REST URL and token.

### 2. Environment variables

Set these in Vercel → Project → Settings → Environment Variables (`.env.example` has the full list):

| Variable | Production value |
| --- | --- |
| `DATABASE_URL` | Pooled connection string |
| `DIRECT_URL` | Direct connection string (used by `prisma migrate deploy`) |
| `NEXTAUTH_SECRET` | `npx auth secret` or `openssl rand -base64 32` (32+ characters) |
| `NEXTAUTH_URL` | Your public URL, e.g. `https://crm.example.com`. Used in email links; on Vercel it falls back to the deployment URL if omitted, but set it so links use your real domain. |
| `RESEND_API_KEY` | `re_…` |
| `EMAIL_FROM` | `CRM <noreply@your-verified-domain.com>` |
| `CRON_SECRET` | A random string, 16+ characters. Vercel sends it to the cron endpoint automatically. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Required (startup check) |
| `TRUSTED_PROXY_COUNT` | Self-hosting only: number of reverse proxies in front of the app (default 1). Ignored on Vercel. See [Self-hosting](#self-hosting-any-node-host). |

The server **checks this list at startup** (`src/instrumentation.ts`) and exits with a readable message if something is missing or weak, so a bad config fails the deploy instead of the first user. Do **not** set `SEED_USER_PASSWORD`, and never run the seed in production.

> **Use a separate database for Preview deployments.** Every build runs `prisma migrate deploy`. In Vercel, scope the production `DATABASE_URL`/`DIRECT_URL` to **Production** only and give **Preview** its own database, or a pull-request build will migrate production.

### 3. Deploy

1. Push the repo to GitHub and import it in Vercel (framework: Next.js; `vercel.json` sets the build command).
2. Deploy. The build runs `prisma migrate deploy && next build` (`npm run vercel-build`), so migrations are applied before the new code goes live.
3. Verify: `curl https://your-app/api/health` returns `{"status":"ok"}`.

### 4. First admin

Public sign-up is closed, so create the first admin directly in the production database:

```bash
DATABASE_URL="<direct production url>" npm run make-admin -- you@example.com --create "Your Name"
```
(Or run `UPDATE "User" SET role = 'ADMIN' WHERE email = '…';` in your database console.) Then use **Forgot password** on the sign-in page to set that admin's password. Roles are re-read on every request, so no sign-out is needed.

### 5. Smoke test

- Invite a real address from Settings → Team: the invitation email arrives.
- "Forgot password": the reset email arrives and the link works.
- Open a contact with an email, click **Send email**: it arrives, replying goes to you, and the timeline shows it.
- As an admin, move another user's deal (or close one of your own): the owner / admins are notified.
- Vercel → Project → Cron Jobs → run `/api/cron/task-reminders` once; the response is `{"ok":true,…}`.

### Database migrations

- Migrations are plain SQL files in `prisma/migrations`, committed to git. **Never edit one that has been deployed**; add a new one.
- Develop: change `schema.prisma`, run `npm run db:migrate -- --name what_changed`, commit the generated folder.
- Deploy: `prisma migrate deploy` applies only the pending migrations, in order. It runs on every Vercel build. CI runs it against an empty database and also checks that `schema.prisma` and the migrations agree (`prisma migrate diff --exit-code`).
- Never use `db push` or `migrate reset` against production.
- **Zero-downtime changes:** old code keeps serving while a migration runs, so ship destructive changes in two steps (expand, then contract). Add a column as nullable or with a default, deploy code that uses it, backfill, and only then make it required. To drop or rename, deploy code that no longer uses the column first, then drop it in a later migration.
- **Rollback:** Prisma has no down migrations. Roll the *app* back with Vercel's Instant Rollback (safe if you followed expand/contract) and fix the database forward with a new migration. Take a backup or branch (Neon branches are instant) before risky migrations.
- A failed `migrate deploy` fails the build, so the previous deployment stays live. Fix the migration; if Prisma reports a failed record, clear it with `prisma migrate resolve`.

### CI/CD

- **GitHub Actions** (`.github/workflows/ci.yml`) runs on every PR and push to `master`: install, apply all migrations to a throwaway Postgres, check schema/migration drift, typecheck, lint and build.
- **Vercel's Git integration** deploys: every PR gets a preview, and merging to `master` deploys production. In GitHub → Settings → Branches, require the CI check on `master` so only green code reaches production.

### Self-hosting (any Node host)

```bash
npm ci && npx prisma migrate deploy && npm run build && npm start
```

Also set `AUTH_TRUST_HOST=true` and `NEXTAUTH_URL`, serve it over HTTPS (the app sends HSTS), and call `GET /api/cron/task-reminders` with `Authorization: Bearer $CRON_SECRET` from your scheduler. Without Upstash, rate limits are per process, which is fine for a single instance.

Rate limits key on the client IP, read from `X-Forwarded-For` **from the right** (a client can forge the left side). Put the app behind a reverse proxy that appends the real client address (nginx: `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`), set `TRUSTED_PROXY_COUNT` to the number of proxies, and never expose the Node port directly to the internet. The bundled `docker-compose.yml` publishes Postgres on `127.0.0.1` only; keep it that way and change its default password on any shared machine.

## Security checklist

Done in code:

- [x] **Secrets:** nothing secret is committed; `.env` is git-ignored; the production env is validated at startup (secret length, email provider, cron secret).
- [x] **Auth:** bcrypt passwords, JWT sessions re-validated against the database on each request, sessions revoked on password change/reset, hashed single-use one-hour reset tokens, no account enumeration on forgot-password.
- [x] **Rate limiting** (429 when exceeded): sign-in 15 per 15 min per IP+email, 50 per IP and 40/h per account (the form checks twice per login); forgot-password 5/h per IP and per address; reset 10/h per IP; magic link 5 per 15 min per address; two-step setup/disable 10 per 15 min per user; contact email 30/h per user; every other API call 600 reads and 120 writes per minute per user. Request bodies over 1 MB are refused (413). Upstash-backed when configured, otherwise in memory (best effort across serverless instances).
- [x] **Two-step verification:** TOTP (RFC 6238) with encrypted-at-rest secrets, single-use codes and hashed one-time recovery codes.
- [x] **Audit trail:** see [Authentication](#authentication).
- [x] **No timing leak on forgot-password / magic link:** the lookup and the email happen after the response is sent.
- [x] **Dependencies:** Next.js 15.5.x; `npm audit --omit=dev` reports 0. Build-time tooling (tailwindcss and its glob helpers) still shows advisories with no upstream fix; they never run in production.
- [x] **CORS:** the API sends no CORS headers, so browsers block cross-origin reads, and preflights get no `Access-Control-Allow-*`. If you ever need a third-party origin, add it explicitly in `src/middleware.ts`; never combine `*` with cookies.
- [x] **CSRF:** cookies are `SameSite=Lax`, and `src/middleware.ts` rejects state-changing `/api` requests whose `Origin` is not this host (403). Auth.js has its own CSRF token for its routes.
- [x] **Headers** (`next.config.mjs`): CSP, HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`; `X-Powered-By` removed; API responses are `Cache-Control: no-store`. The CSP allows inline scripts and styles (needed by Next.js and the theme switch); tighten it with nonces if you add third-party content.
- [x] **Input:** every body and query is validated with Zod; Prisma parameterises all SQL; email subjects reject line breaks (header injection) and email HTML escapes user text.
- [x] **Authorization:** non-admins can only read, edit and email their own records; the cron endpoint requires `CRON_SECRET` (constant-time compare, closed when unset).
- [x] **Errors:** unexpected errors return a generic 500; details go to the server log only.

Do before going live:

- [ ] Verify your domain with Resend and publish SPF/DKIM (Resend shows the records); add a DMARC record.
- [ ] Add Upstash Redis for shared rate limits.
- [ ] Separate Preview and Production databases and secrets.
- [ ] Turn on database backups / point-in-time recovery.
- [ ] Rotate `NEXTAUTH_SECRET` and `CRON_SECRET` if they were ever shared (rotating the auth secret signs everyone out).
- [ ] Admins are required to use two-step verification in production (`REQUIRE_ADMIN_MFA`, default on): until they enrol they get a Sales-level session. Ask each admin to enrol on first sign-in. Other users can opt in under Settings → Security.
- [ ] Add error monitoring (Sentry or Vercel log drains) and an uptime check on `/api/health`.
- [ ] Enable GitHub secret scanning and Dependabot; run `npm audit` regularly.

## Prerequisites

- Node.js 18.18+ (tested on 24)
- A PostgreSQL 14+ database: local install, Docker, or hosted (Neon, Supabase)

## Setup

```bash
npm install
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
# Optional local Postgres via Docker:
docker compose up -d
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

If your package manager skips install scripts, run `npm run db:generate` manually to generate the Prisma client.

Seeded users (all use `SEED_USER_PASSWORD`, default `ChangeMe123!`):

| Email | Role |
| --- | --- |
| admin@crm.test | ADMIN |
| sales@crm.test | SALES |
| support@crm.test | SUPPORT |

The seed also creates 5 organizations, 12 contacts, 8 deals, 10 activities and 8 tasks. It is re-runnable: it clears existing CRM data first.

## Data model

```
User ─┬─< Organization (owner)
      ├─< Contact (owner)
      ├─< Deal (owner)
      ├─< Activity (author)
      └─< Task (assignee / creator)

Organization ─┬─< Contact
              ├─< Deal
              └─< Activity
Contact ─┬─< Deal
         ├─< Activity
         └─< Task
Deal ─┬─< Activity
      └─< Task
```

- **Roles:** `ADMIN`, `SALES`, `SUPPORT`
- **Contact types:** `LEAD`, `PROSPECT`, `CUSTOMER`, `PARTNER`, `OTHER`, with a `LeadStatus` for lead qualification
- **Deal stages:** `QUALIFICATION`, `DISCOVERY`, `PROPOSAL`, `NEGOTIATION`, `CLOSED_WON`, `CLOSED_LOST`
- Foreign keys are indexed, and there are extra indexes on deal stage and close date, contact name and type, and task assignee/status/due date.
- Deleting a user who owns deals, activities or tasks is blocked (`Restrict`). Optional ownership links are set to null.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js dev server |
| `npm run build` / `start` | Production build and serve |
| `npm run vercel-build` | Migrate, then build (used by Vercel) |
| `npm run typecheck` | TypeScript check |
| `npm run db:generate` | Generate the Prisma client |
| `npm run db:migrate` | Create and apply a migration (dev) |
| `npm run db:deploy` | Apply pending migrations (production, CI) |
| `npm run make-admin -- <email> [--create "Name"]` | Promote a user to admin (create them first with `--create`) |
| `npm test` | Run the unit tests (Vitest) |
| `npm run db:push` | Push the schema without a migration |
| `npm run db:seed` | Seed sample data |
| `npm run db:reset` | Drop, re-migrate and re-seed |
| `npm run db:studio` | Open Prisma Studio |

## Project structure

```
prisma/             schema, migrations (committed), seed
scripts/            make-admin.ts (promote the first admin in production)
src/
  app/              App Router: pages in (app) and (auth), REST API under api/
  instrumentation.ts   validates the production environment at server start
  middleware.ts     auth gate + same-origin check for API writes
  lib/
    mail.ts         provider selection (Resend / SMTP / console) and sendMail
    email-templates.ts   all email content (HTML + text)
    notifications.ts     deal-stage notifications and task reminders
    rate-limit.ts   fixed-window limiter (Upstash Redis or in-memory)
    env.ts          production environment contract
.github/workflows/ci.yml   migrations check, typecheck, lint, build
vercel.json         build command and the daily reminder cron
```
