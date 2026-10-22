-- Phase 2 of MULTI_TENANCY_PLAN.md: row-level security, the database's own refusal to cross businesses.
--
-- Every business table gets a policy: a row is visible, and can be written, only when its "tenantId" equals the
-- setting app.tenant_id, which the application sets inside each query's transaction (src/lib/db.ts). With the
-- setting missing or empty the comparison is NULL, so no row matches: forgetting the context fails closed.
--
-- Policies apply to roles that are not the table owner and do not bypass row-level security. The app connects as
-- "crm_app" (created here without a login: give it one with ALTER ROLE crm_app LOGIN PASSWORD '...', see
-- TECHNICIAN.md). The owner role that runs migrations and the platform client (PLATFORM_DATABASE_URL) owns the
-- tables and is deliberately not forced, so it can still read across businesses. Superusers bypass as always.
--
-- Not covered here, on purpose: a foreign key is checked by the database itself, so a row could still point at
-- another business's row; the application refuses that (assertLinks) and a read through the link returns nothing.

-- Creating a role needs CREATEROLE, which a plain database owner (a local development database) may lack. Then
-- the role is skipped with a notice, the policies below are still created, and they simply don't bind the owner:
-- row-level security is enforced once the app connects as a role that is not the owner (see TECHNICIAN.md).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'crm_app') THEN
    BEGIN
      CREATE ROLE crm_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'crm_app was not created (no CREATEROLE): create it as an administrator, then run the GRANT and REVOKE statements in TECHNICIAN.md';
    END;
  END IF;

  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'crm_app') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO crm_app', current_schema());
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO crm_app', current_schema());
    -- The app never creates or changes a business, never edits or deletes the audit log (its triggers refuse that
    -- anyway), and never touches the sign-in plumbing tables, which only the platform client uses.
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON "Tenant" FROM crm_app';
    EXECUTE 'REVOKE UPDATE, DELETE ON "AuditLog" FROM crm_app';
    EXECUTE 'REVOKE ALL ON "Account", "Session", "VerificationToken" FROM crm_app';
  END IF;
END
$$;

-- A business can see only its own row.
ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Tenant"
  USING ("id" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "User"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Organization"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "Contact" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Contact"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "Deal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Deal"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "Activity" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Activity"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "Task" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Task"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "Tag" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Tag"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "ContactTag" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ContactTag"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "SavedFilter" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SavedFilter"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "EmailTemplate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EmailTemplate"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "AutomationSetting" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AutomationSetting"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Invoice"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "InvoiceItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "InvoiceItem"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Payment"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "PaymentLink" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PaymentLink"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "Instalment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Instalment"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "InstalmentReminder" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "InstalmentReminder"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "DealItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DealItem"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "StockAdjustment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StockAdjustment"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AuditLog"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));
