-- Phase 5: a business that asked to be deleted is read-only until the grace period ends, then erased.
ALTER TABLE "Tenant" ADD COLUMN "deletionRequestedAt" TIMESTAMP(3);

-- The audit log stays append-only, with one exception: erasing a whole business removes that business's own rows
-- (they hold its users' emails and IP addresses). The erasure job names the business in app.erasing_tenant for its
-- own transaction; a row of any other business, and every UPDATE and TRUNCATE, is still refused. The app role has no
-- DELETE privilege on the table at all (row-level security migration), so it cannot use this.
CREATE OR REPLACE FUNCTION "audit_log_append_only"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."tenantId" = NULLIF(current_setting('app.erasing_tenant', true), '') THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'AuditLog is append-only (% is not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;
