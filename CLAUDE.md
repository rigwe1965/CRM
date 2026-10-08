# Ivycandy Hair CRM
CRM for a hair retailer (contacts, deals, instalment payments, invoices, stock). Next.js, Prisma/PostgreSQL, Auth.js v5, TanStack Query, Tailwind/shadcn.

## Commands
Dev server runs on port 3001. `npm run db:seed` WIPES data: never on real data.

## Conventions
- Money is kept per currency (`MoneyMap`, `src/lib/money.ts`); never sum across currencies.
- Scope queries with `ownerScope`; admins see all (`src/lib/access.ts`).
- Contacts, deals and orgs are soft-deleted.
- API routes use `authed()` (auth, rate limit, audit log of every write); Decimals become numbers in DTOs. Routes that hard-delete call `audit()` with a snapshot first (`src/lib/audit.ts`).
- Schema changes: add hand-written migration SQL, restart the dev server.

## Rules
- Do not change code without an approved plan from the owner.
- Keep seed data as a newcomer sample; don't clear it unless asked.

Docs: `HANDOVER.md`, `TECHNICIAN.md`, `README.md`. Playbooks: skill `ivycandy-crm`.
