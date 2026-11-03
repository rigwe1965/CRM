-- Faster contact lists for large businesses (NEXT_LEVEL_PLAN.md Phase 3, PHASE3_BASELINE.md).
--
-- Every contact list is one business, sorted newest-first or A-Z, so these indexes lead with "tenantId". Indexes only:
-- no data and no column changes, so this cannot fail on old rows. The single-column indexes they supersede are kept
-- until the numbers are re-measured. (tenantId, createdAt) carries no "deletedAt": Postgres cannot use an index order across
-- an IS NULL test, and deleted rows are few, so the filter is cheap. On a very large live table, create them first with CREATE INDEX CONCURRENTLY by
-- hand (same names) and this migration then finds them already there.

CREATE INDEX IF NOT EXISTS "Contact_tenantId_createdAt_idx" ON "Contact"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "Contact_tenantId_lastName_firstName_idx" ON "Contact"("tenantId", "lastName", "firstName");
CREATE INDEX IF NOT EXISTS "Contact_tenantId_ownerId_createdAt_idx" ON "Contact"("tenantId", "ownerId", "createdAt");
