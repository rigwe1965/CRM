# Phase 3 baseline: contact list queries (measured 2026-11-03)

Tool: `scripts/perf-baseline.ts` (throwaway `perf_test_…` schema, dropped afterwards; owner connection, so row-level
security is not in these numbers). Local Postgres on a developer laptop, 200,000 contacts in total, 15 timed runs each.

| Query (Prisma, as the API issues it)           | 5 businesses x 40,000 | 200 businesses x 1,000 |
| ---------------------------------------------- | --------------------: | ---------------------: |
| list by name, page 1                           |                2.1 ms |                 4.7 ms |
| list by createdAt desc, page 1                 |           **81.5 ms** |                 2.2 ms |
| list by name, offset 10,000                    |           **82.7 ms** |                 8.7 ms |
| count of live contacts                         |               18.3 ms |                 0.9 ms |
| search "okafor1" (name/email, case-insensitive)|          **370.5 ms** |                 7.0 ms |
| owner-scoped list                              |           **89.1 ms** |                 2.9 ms |

## What it says

- **The number of businesses is not the problem; the size of one business is.** Postgres finds a small business's rows
  through the `tenantId` index and sorts the few it gets. Cost grows with the biggest single business.
- The existing indexes are single-column (`lastName,firstName`, `ownerId`, `deletedAt`, ...) and none starts with
  `tenantId`. For a large business the planner walks a global index and throws away other businesses' rows
  (search plan: 160,120 rows removed to return 25).
- Search uses `ILIKE '%text%'`, which no ordinary index can serve. It reads the whole business, so it is the slowest.
- Offset pagination and `count(*)` re-read rows on every page; both grow linearly with business size.
- Plan limits cap `starter` at 1,000 contacts and `pro` at 25,000, so only `internal` (unlimited) can reach the
  40,000 case today. At 25,000 expect roughly 50 ms for the slow lists, 230 ms for search.

## Proposed fixes (need approval: each is a schema migration)

1. Composite indexes led by `tenantId`: `(tenantId, deletedAt, createdAt)`, `(tenantId, lastName, firstName)`,
   `(tenantId, ownerId, createdAt)`. Drop single-column indexes they replace only after measuring.
2. Trigram (`pg_trgm`) GIN index on name/email for search, which makes `ILIKE '%x%'` indexed. Needs the extension
   allowed by the database provider (check first).
3. Optional later: keyset pagination for deep pages; a cheaper or cached count.

Re-run the script after each change; success = every row above under 20 ms at 40,000 contacts in one business.

## After the tenant-led indexes (PR #14, measured 2026-11-03, 5 businesses x 40,000)

| Query                              | Before |  After |
| ---------------------------------- | -----: | -----: |
| list by name, page 1               | 2.1 ms | 1.9 ms |
| list by createdAt desc, page 1     |  82 ms | 1.8 ms |
| list by name, offset 10,000        |  83 ms |  36 ms |
| count of live contacts             |  18 ms |  22 ms |
| owner-scoped list                  |  89 ms | 1.8 ms |
| search "okafor1"                   | 371 ms | 197 ms |
| search by phone fragment           |  29 ms |  30 ms |

- `(tenantId, deletedAt, createdAt)` did not help the newest-first list: Postgres cannot use an index order across an
  `IS NULL` test. `(tenantId, createdAt)` did.
- **Not measured:** the trigram indexes. The local Postgres blocks `pg_trgm.dll` (Windows Application Control), so search
  numbers above are without them. CI applied the migration and production's deploy accepted it (so the extension is
  allowed there), but the speed-up still needs a run on a database that loads `pg_trgm`.
- **Still over the 20 ms target (when measured):** deep pages (36 ms) and the count (22 ms); see the next section for the count.

## After the count index (`20261128000000_contact_count_index`, measured 2026-11-03)

Count of live contacts at 40,000 contacts in one business: **22 ms to 3.8 ms** (median; p95 10 ms). An index-only scan needs
the table's visibility map, which autovacuum keeps current in production; the script now runs `VACUUM ANALYZE "Contact"`
after filling so it measures what production sees (without it the count stayed at 22 ms). Deep pages stay at about 30-36 ms
(accepted, PHASE3_COUNT_PLAN.md). Search is still unmeasured with trigram indexes on this machine.
