-- Index-only contact count (PHASE3_COUNT_PLAN.md, approved by the owner).
--
-- Every contact list counts "this business's live contacts" (tenantId = ? AND deletedAt IS NULL). With this index
-- Postgres answers that from the index alone instead of reading every contact row. Index only: no data or column
-- changes, so it cannot fail on old rows. A plain CREATE INDEX blocks writes to "Contact" while it builds (seconds at
-- pilot size); on a very large live table, create it first with CREATE INDEX CONCURRENTLY by hand (same name) and this
-- migration then finds it already there.

CREATE INDEX IF NOT EXISTS "Contact_tenantId_deletedAt_idx" ON "Contact"("tenantId", "deletedAt");
