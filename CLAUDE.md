# Ivycandy Hair CRM

CRM for a hair retailer: contacts, deals with line items, customer instalment payments, supplier invoices, stock, dashboard. Stack: Next.js 14, TypeScript, Prisma 6 + PostgreSQL, Auth.js v5, TanStack Query, Tailwind/shadcn.

## Commands
`npm run dev` (port 3001) · `npm run typecheck` · `npm run lint` · `npm run db:push` (dev DB) · `npm run db:seed` (WIPES data; never on real data)

## Conventions
- Money is kept per currency (`MoneyMap` in `src/lib/money.ts`); never sum across currencies.
- Scope queries with `ownerScope`; admins see all (`src/lib/access.ts`).
- Contacts, deals and orgs are soft-deleted.
- API routes use the `authed()` wrapper (auth, rate limit, audit log of every write); Decimals become numbers in DTOs. Routes that hard-delete records call `audit()` with a snapshot first (`src/lib/audit.ts`).
- After schema changes: add hand-written migration SQL, then restart the dev server.

## Rules
- Do not change code without an approved plan from the owner.
- Seed data is kept as a sample for newcomers; do not clear it unless asked.

Docs: `HANDOVER.md`, `TECHNICIAN.md`, `README.md`. Playbooks: skill `ivycandy-crm`.
