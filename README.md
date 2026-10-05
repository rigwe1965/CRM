# CRM

A modern full-stack CRM. Done so far: database foundation, authentication and the REST API. The dashboard UI and email features come next.

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind CSS (shadcn/ui config prepared)
- PostgreSQL + Prisma 6
- Zod for validation
- Auth.js v5 (`next-auth@beta`) with the Prisma adapter and JWT sessions

## Authentication

- **Pages:** `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`, `/verify-request`, `/profile`, `/unauthorized`
- **Methods:** email + password, or a magic link ("Use a magic link instead" on the sign-in page)
- **Roles:** `ADMIN`, `SALES`, `SUPPORT`. `ADMIN` passes every role check. Sign-up always creates a `SALES` user; promote users with `PATCH /api/admin/users/:id` (admin only) or in Prisma Studio. The seed creates an admin.
- **Route protection:** `src/middleware.ts` is a coarse JWT-based gate (everything is private except the public paths in `src/lib/rbac.ts`). Role-restricted prefixes (`/admin`, `/api/admin`) are listed in the same file. Pages and handlers re-check against the database with the helpers below.
- **Server helpers** (`src/lib/auth-helpers.ts`):
  - `getCurrentUser()`
  - `requireUser()` and `requireRole("ADMIN")` for pages (redirect)
  - `requireApiUser("SALES")` for route handlers (returns 401/403 responses)
- **Sessions:** JWT cookies (30 days). Each session read re-checks the user in the database, so deactivating a user or changing their role takes effect immediately. Changing or resetting a password signs out all existing sessions.
- **Password reset:** one-hour, single-use token. Only its SHA-256 hash is stored (in the `VerificationToken` table). The forgot-password endpoint never reveals whether an email is registered.
- **Email in development:** with `EMAIL_SERVER` unset, magic and reset links are printed to the **server console**. Production requires `EMAIL_SERVER`.
- **Self-hosting:** set `AUTH_TRUST_HOST=true` when using `next start` behind your own domain.
- **Not included yet:** rate limiting on sign-in, sign-up and reset endpoints, and email verification for password sign-ups. Add both before going public.

## REST API

All endpoints live under `/api`, return JSON and need a signed-in session (cookie). The machine-readable spec is generated from the same Zod schemas the handlers validate with: **`GET /api/openapi.json`** (OpenAPI 3.1; import it into Swagger UI, Postman or Insomnia).

| Resource | Endpoints |
| --- | --- |
| Organizations | `GET/POST /api/organizations`, `GET/PATCH/DELETE /api/organizations/:id`, `POST …/:id/restore` (admin) |
| Contacts (leads, customers) | `GET/POST /api/contacts`, `GET/PATCH/DELETE /api/contacts/:id`, `POST …/:id/convert`, `POST …/:id/restore` (admin) |
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
| `npm run typecheck` | TypeScript check |
| `npm run db:generate` | Generate the Prisma client |
| `npm run db:migrate` | Create and apply a migration (dev) |
| `npm run db:push` | Push the schema without a migration |
| `npm run db:seed` | Seed sample data |
| `npm run db:reset` | Drop, re-migrate and re-seed |
| `npm run db:studio` | Open Prisma Studio |

## Project structure

```
prisma/
  schema.prisma     data model
  seed.ts           sample data
src/
  app/              Next.js App Router (starter page only)
  lib/
    db.ts           Prisma client singleton
    utils.ts        cn() helper (shadcn)
    validations/    Zod schemas (later)
components.json     shadcn/ui config
docker-compose.yml  optional local Postgres
```

## shadcn/ui

`components.json` and `cn()` are in place. When you start the UI step, run `npx shadcn@latest init` to add the CSS variables and theme, then `npx shadcn@latest add <component>`.

## Next steps

1. UI (dashboard, contacts, deals pipeline, tasks)
2. Email (notifications, templates)
3. Hardening: rate limiting, email verification
