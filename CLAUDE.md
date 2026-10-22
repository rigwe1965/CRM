# Ivycandy Hair CRM

CRM for a hair retailer (contacts, deals, instalment payments, invoices, stock). Next.js, Prisma/PostgreSQL, Auth.js v5, TanStack Query, Tailwind/shadcn.

## Commands

Dev server runs on port 3001. `npm run db:seed` WIPES data: never on real data.

## Conventions

- Money is kept per currency (`MoneyMap`, `src/lib/money.ts`); never sum across currencies.
- Scope queries with `ownerScope` (or `tenantScope` for tables with no owner); both name the caller's business, and admins see their whole business, never another's (`src/lib/access.ts`). `tests/tenant-scoping.test.ts` fails on a query that doesn't. Postgres row-level security is the backstop: `db` runs as the request's business (`withTenant`, set by `authed()`); only the files listed in that test may use `platformDb`, and work that outlives the handler must re-enter the business.
- Contacts, deals and orgs are soft-deleted.
- API routes use `authed()` (auth, rate limit, audit log of every write); Decimals become numbers in DTOs. Routes that hard-delete call `audit()` with a snapshot first (`src/lib/audit.ts`).
- Schema changes: add hand-written migration SQL, restart the dev server.

## Rules

- Do not change code without an approved plan from the owner.
- Keep seed data as a newcomer sample; don't clear it unless asked.

Docs: `HANDOVER.md`, `TECHNICIAN.md`, `README.md`. Playbooks: skill `ivycandy-crm`.
