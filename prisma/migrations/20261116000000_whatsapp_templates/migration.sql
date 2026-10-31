-- WhatsApp message templates, copied from Meta so staff can pick an approved one to send (sending comes in a later step).

-- CreateTable
CREATE TABLE "WhatsappTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'UTILITY',
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "supported" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "slots" JSONB NOT NULL DEFAULT '[]',
    "metaId" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappTemplate_tenantId_name_language_key" ON "WhatsappTemplate"("tenantId", "name", "language");
CREATE INDEX "WhatsappTemplate_tenantId_status_idx" ON "WhatsappTemplate"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "WhatsappTemplate" ADD CONSTRAINT "WhatsappTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security, as for every business table (see 20261031000000_row_level_security).
ALTER TABLE "WhatsappTemplate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WhatsappTemplate"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'crm_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "WhatsappTemplate" TO crm_app';
  END IF;
END
$$;
