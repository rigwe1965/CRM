-- Private links a customer opens to see one order (what is paid, what is due). The token is never stored in the clear:
-- "tokenHash" finds the row on a visit, "tokenSealed" (encrypted) lets staff and reminders show the same link again.

-- CreateTable
CREATE TABLE "CustomerOrderLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenSealed" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerOrderLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOrderLink_tokenHash_key" ON "CustomerOrderLink"("tokenHash");
CREATE INDEX "CustomerOrderLink_tenantId_dealId_idx" ON "CustomerOrderLink"("tenantId", "dealId");
CREATE INDEX "CustomerOrderLink_createdById_idx" ON "CustomerOrderLink"("createdById");

-- AddForeignKey
ALTER TABLE "CustomerOrderLink" ADD CONSTRAINT "CustomerOrderLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerOrderLink" ADD CONSTRAINT "CustomerOrderLink_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerOrderLink" ADD CONSTRAINT "CustomerOrderLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security, as for every business table (see 20261031000000_row_level_security).
ALTER TABLE "CustomerOrderLink" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CustomerOrderLink"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'crm_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "CustomerOrderLink" TO crm_app';
  END IF;
END
$$;
