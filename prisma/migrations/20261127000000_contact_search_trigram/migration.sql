-- Indexed contact search (NEXT_LEVEL_PLAN.md Phase 3, PHASE3_BASELINE.md).
--
-- The contact search is ILIKE '%text%', which an ordinary index cannot serve; trigram (pg_trgm) GIN indexes can.
-- Needs the pg_trgm extension (a "trusted" extension since Postgres 13, so the database owner may create it; check that
-- your provider allows it before deploying). Separate from the tenant indexes so a database that cannot load the
-- extension still gets those. Indexes only: no data changes. On a very large live table, create the indexes first with
-- CREATE INDEX CONCURRENTLY by hand (same names) and this migration then finds them already there.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- The operator class lives in whatever schema the extension was installed in (public on most databases, "extensions" on
-- some providers), and it may not be on the search_path (the test suite migrates into throwaway schemas), so it is
-- looked up and written with its schema.
DO $$
DECLARE ext text := (SELECT quote_ident(n.nspname) FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pg_trgm');
BEGIN
  EXECUTE 'CREATE INDEX IF NOT EXISTS "Contact_lastName_trgm_idx" ON "Contact" USING GIN ("lastName" ' || ext || '.gin_trgm_ops)';
  EXECUTE 'CREATE INDEX IF NOT EXISTS "Contact_firstName_trgm_idx" ON "Contact" USING GIN ("firstName" ' || ext || '.gin_trgm_ops)';
  EXECUTE 'CREATE INDEX IF NOT EXISTS "Contact_email_trgm_idx" ON "Contact" USING GIN ("email" ' || ext || '.gin_trgm_ops)';
  EXECUTE 'CREATE INDEX IF NOT EXISTS "Contact_phone_trgm_idx" ON "Contact" USING GIN ("phone" ' || ext || '.gin_trgm_ops)';
END
$$;
