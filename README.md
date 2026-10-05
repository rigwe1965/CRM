# CRM

A modern full-stack CRM. This step is the **foundation and database only**: project scaffold, Prisma schema and seed data. Auth, API routes, UI and email come in later steps.

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind CSS (shadcn/ui config prepared)
- PostgreSQL + Prisma 6
- Zod for validation (used in later steps)
- Auth.js tables are already in the schema; auth itself is not implemented yet

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
