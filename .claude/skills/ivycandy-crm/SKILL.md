---
name: ivycandy-crm
description: Playbooks for working on the Ivycandy Hair CRM (Next.js + Prisma). Use when adding fields or models, changing deals, payments, invoices or stock, running checks, or touching the database.
---

# Ivycandy Hair CRM playbooks

Always get an approved plan from the owner before changing code.

## Domain in one minute
- Deal = a sale with `DealItem` lines. Payments (`Payment`) and an optional schedule (`Instalment`) hang off a deal.
- Payments apply oldest-first (`src/lib/payments.ts`). Overdue = uncovered instalment past due; due today is not overdue.
- `Invoice` = supplier stock purchase (`InvoiceItem` lines); linked many-to-many to deals.
- Stock (`src/lib/stock.ts`) matches invoice lines to sold deal items on product + colour + length, case-insensitive. Sold stages: PROPOSAL, NEGOTIATION, CLOSED_WON.
- Dashboard and cash flow (`src/lib/cashflow.ts`) are per currency.
- Daily cron `/api/cron/task-reminders` sends task and instalment reminders.

## Add a field or model
1. Edit `prisma/schema.prisma`.
2. Add a hand-written migration folder in `prisma/migrations/<timestamp>_<name>/migration.sql`.
3. `npm run db:push` for the dev DB, then restart the dev server (stale client causes "Unknown field").
4. Add zod schema in `src/lib/validations/crm.ts`.
5. Update the DTO (`src/lib/deals.ts`, `invoices.ts`, etc.; Decimal to number) and the route in `src/app/api/...` using `authed()` and `ownerScope`.
6. Update client types/hooks in `src/lib/client/` and the UI in `src/app/(app)/` or `src/components/forms/`.
7. Update `src/lib/openapi.ts` if the API shape is documented.

## Verify
- `npm run typecheck` and `npm run lint`.
- Test the API as `sales@crm.test` (owns even-indexed seed deals) and `admin@crm.test`. Password is `SEED_USER_PASSWORD` in `.env`.
- Leave no test records behind in the dev DB; the user keeps real data there (Adaeze Okafor's order, invoices `-002`, `-003`).
- Do not stamp `reminderSentAt` on real tasks or instalments when testing the cron.

## Never
- Run `npm run db:seed` or `db:reset` against real data.
- Sum amounts across currencies.
- Skip owner scoping on a new query.
- Delete seed data; it is a newbie sample.
- Print secrets from `.env`.
