# Plan: the last two slow contact-list queries (proposal, for approval)

Status: **proposal only. No code has been changed.** Follows `PHASE3_BASELINE.md`.

## What is left

After the tenant-led indexes (PR #14), two queries are over the 20 ms target at 40,000 contacts in one business:

| Query                         | Now   | Target |
| ----------------------------- | ----: | -----: |
| count of live contacts        | 22 ms | 20 ms  |
| deep page (offset 10,000)     | 36 ms | 20 ms  |

## Recommendation: do the small fix, skip keyset pagination

I first proposed keyset pagination. Having read the UI, I no longer recommend it:

- The list screens show numbered pages ("page 3 / 40", `meta.totalPages`, `src/components/common/page.tsx`) and the API
  returns `{ page, pageSize, total, totalPages }` for six routes. Keyset pagination has no "page 3" and no cheap total, so
  it would change the API contract and the screens for a gain nobody feels.
- Offset cost is bounded by the plan limits: `pro` allows 25,000 contacts, so the deepest page is about 25,000 / 20 = 1,250
  and costs roughly 80 ms. A person does not page that far; they search or filter.

### Step 1 (needs approval): one index for the count

`CREATE INDEX "Contact_tenantId_deletedAt_idx" ON "Contact"("tenantId", "deletedAt")` lets Postgres answer
`count(*) WHERE tenantId = ? AND deletedAt IS NULL` from the index alone (an index-only scan) instead of reading 40,000
rows. Expected: about 22 ms down to under 10 ms (to be measured). A hand-written migration, indexes only, no data change,
same shape as `20261126000000_contact_tenant_indexes`. No API change.

### Step 2 (no approval needed, measurement only)

Re-run `scripts/perf-baseline.ts` on a database that can load `pg_trgm` (CI's Docker Postgres or local Docker) to measure
the trigram search for the first time, and record all numbers in `PHASE3_BASELINE.md`.

### Not doing (unless you say otherwise)

- Keyset pagination and any change to the `paginated()` response.
- Caching the count. It adds staleness to a number people read as exact.
- Dropping the old single-column indexes. They cost writes but their removal needs a separate measurement of write speed.

## Risks

- A plain `CREATE INDEX` blocks writes to `Contact` while it builds (seconds at pilot size). Same as PR #14.
- The deep-page target (20 ms) is accepted as missed: 36 ms at 40,000 contacts, about 80 ms at the 25,000-contact plan limit's deepest page.

## Decision needed

Approve Step 1 (one index) and the decision to leave deep pages as they are? Yes / no / change.
