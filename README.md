# CRM

A modern full-stack CRM. Done so far: database foundation and authentication. The dashboard, CRM API routes and email features come next.

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

After pulling this change, run `npm run db:migrate` again: the schema gained `User.passwordChangedAt`.

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
npm run db:migrate -- --name init
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

1. Auth (Auth.js with credentials and role-based access)
2. API routes with Zod validation
3. UI (dashboard, contacts, deals pipeline, tasks)
4. Email
