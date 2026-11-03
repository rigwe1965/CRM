-- Indexed contact search (NEXT_LEVEL_PLAN.md Phase 3, PHASE3_BASELINE.md).
--
-- The contact search is ILIKE '%text%', which an ordinary index cannot serve; trigram (pg_trgm) GIN indexes can.
-- Needs the pg_trgm extension (a "trusted" extension since Postgres 13, so the database owner may create it; check that
-- your provider allows it before deploying). Separate from the tenant indexes so a database that cannot load the
-- extension still gets those. Indexes only: no data changes. On a very large live table, create the indexes first with
-- CREATE INDEX CONCURRENTLY by hand (same names) and this migration then finds them already there.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Contact_lastName_trgm_idx" ON "Contact" USING GIN ("lastName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Contact_firstName_trgm_idx" ON "Contact" USING GIN ("firstName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Contact_email_trgm_idx" ON "Contact" USING GIN ("email" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Contact_phone_trgm_idx" ON "Contact" USING GIN ("phone" gin_trgm_ops);
