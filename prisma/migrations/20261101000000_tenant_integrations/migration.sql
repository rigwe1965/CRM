-- Phase 3 of MULTI_TENANCY_PLAN.md: each business keeps its own Stripe, WhatsApp and website-form settings.
-- `config` holds the settings as JSON, encrypted by the application; the database never sees them in clear.

-- CreateEnum
CREATE TYPE "IntegrationKind" AS ENUM ('STRIPE', 'WHATSAPP', 'LEAD_FORM');

-- CreateTable
CREATE TABLE "TenantIntegration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "IntegrationKind" NOT NULL,
    "config" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantIntegration_tenantId_kind_key" ON "TenantIntegration"("tenantId", "kind");

-- AddForeignKey
ALTER TABLE "TenantIntegration" ADD CONSTRAINT "TenantIntegration_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security, as for every business table (see 20261031000000_row_level_security).
ALTER TABLE "TenantIntegration" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantIntegration"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'crm_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "TenantIntegration" TO crm_app';
  END IF;
END
$$;
