-- Low-stock alerts: a level per stock row, and a note of when its alert went out.
-- A stock row is worked out from invoices, sales and adjustments, so it is named by its key (product|colour|length).

-- CreateTable
CREATE TABLE "StockThreshold" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '',
    "lengthInches" INTEGER,
    "threshold" INTEGER,
    "alertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockThreshold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockThreshold_tenantId_key_key" ON "StockThreshold"("tenantId", "key");

-- CreateIndex
CREATE INDEX "StockThreshold_tenantId_idx" ON "StockThreshold"("tenantId");

-- AddForeignKey
ALTER TABLE "StockThreshold" ADD CONSTRAINT "StockThreshold_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security, as for every business table (see 20261031000000_row_level_security).
ALTER TABLE "StockThreshold" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StockThreshold"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'crm_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "StockThreshold" TO crm_app';
  END IF;
END
$$;
