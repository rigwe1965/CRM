# Plan: taking the CRM to the next level (proposal, for approval)

Status: **Phase 1 approved by the owner. Phases 2-4 await approval.**

Four directions were chosen: ship the current branch, performance and infrastructure, new product features, reliability and operations. They are ordered so each phase makes the next one safer.

## Phase 1: Ship the current branch (about 1-2 days)

Goal: a verified base. The RLS and same-business-link work is not yet proven against a real database.

1. Run the 13 database-gated test files against Postgres with `TEST_DATABASE_URL` set (they skip silently without it). Needs Docker Desktop running, or a local Postgres plus the `crm_app` role from `docker/init-roles.sql`.
2. Run `scripts/audit-cross-tenant-links.sql` against a copy of real data. Any rows it finds must be resolved before the triggers in migration `20261125000000_same_tenant_links` go to production.
3. Fix `tests/client-ip.test.ts:62`, which fails when `SIGNUP_ENABLED` is set in the shell or `.env`. The test should clear that variable itself. Test-only change.
4. Merge the PR once CI (which already has Postgres 16) is green.

Done when: full suite has 0 failures and 0 database-gated skips locally, and CI is green.

## Phase 2: Reliability and operations (about 1 week)

1. **CI**: confirm CI runs the database tests with `TEST_DATABASE_URL`, with the restricted role, and fails if any are skipped (a "no skipped DB tests in CI" guard).
2. **Migrations**: a check that every migration applies to a fresh database and to a copy of production-shaped data; keep the weekly restore drill (`restore-drill.yml`) and record the result.
3. **Monitoring**: error tracking, alerting on `/api/health`, cron-failure alerts (daily reminders, billing).
4. **Backups and recovery**: document and test a point-in-time recovery, and the per-business export/delete paths.
5. **Go-live checklist**: work through `LAUNCH_RUNBOOK.md` and `HANDOVER.md` section 6 as tracked items.

Done when: a failed deploy, failed cron or failed backup alerts someone, and the restore has been rehearsed.

## Phase 3: Performance and infrastructure (about 1-2 weeks)

Measure first; change only what the numbers justify.

1. **Baseline**: seed a large synthetic dataset (many businesses, 100k+ contacts, many deals and payments) in a throwaway schema and time the main screens and API routes (dashboard, contact lists, reports, export, AI assistant tools).
2. **Queries**: review the slowest with `EXPLAIN`; add indexes via hand-written migrations. Check that RLS policies and `withTenant` do not defeat index use.
3. **Pagination and limits**: confirm every list endpoint is paginated; cap export sizes or stream them.
4. **Connections**: confirm pooling settings (`DATABASE_URL` pooled, `DIRECT_URL` for migrations) under concurrent load.
5. **Background work**: move slow work (exports, imports, reminder runs) off the request path, re-entering the business as the conventions require.
6. **Caching**: only for read-heavy, rarely changing data, and never across businesses.

Done when: documented p95 targets for the key routes are met at the target data size.

## Phase 4: New product features (ongoing, chosen with the owner)

Not planned in detail yet because they depend on what shops need most. Candidates, each to get its own short plan before any code:

- Richer reports (per-currency, never summed across currencies).
- Automations: payment reminders, follow-up tasks, low-stock alerts.
- Customer-facing links: invoice view and pay, instalment schedule.
- WhatsApp and email templates wired into deal events.
- AI assistant improvements (see `AI_ASSISTANT_PLAN.md`).

Each feature follows the existing conventions: `ownerScope`/`tenantScope`, `authed()`, soft deletes, hand-written migrations.

## Risks

- Phase 1 step 2 may find cross-business links in real data; fixing that is a data change and needs separate approval.
- Index and background-job changes alter production behaviour; each ships with a rollback note.
- No phase touches seed data (it stays as the newcomer sample).

## Decisions needed from the owner

1. Approve Phase 1 now? (Recommended; it is low risk and unblocks the rest.)
2. Is a hosted Postgres available for load testing, or should it run locally in Docker?
3. Which Phase 4 candidates matter most to the shops?
4. Target size: how many businesses and contacts should the system comfortably handle?
