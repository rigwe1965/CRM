-- Included AI, step 1 (INCLUDED_AI_PLAN.md): a credit ledger, and a record of which AI calls ran on the platform's key.
-- Nothing changes for any business until an owner sets INCLUDED_AI_ANTHROPIC_KEY and a plan allowance: every existing
-- AiUsage row keeps platformKey = false and creditMicros = 0.
--
-- Rollback:
--   DROP TABLE "AiCredit";
--   ALTER TABLE "AiUsage" DROP COLUMN "platformKey", DROP COLUMN "creditMicros";

ALTER TABLE "AiUsage" ADD COLUMN "platformKey" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AiUsage" ADD COLUMN "creditMicros" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AiCredit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "amountMicros" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCredit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiCredit_amount_positive" CHECK ("amountMicros" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "AiCredit_tenantId_reference_key" ON "AiCredit"("tenantId", "reference");
CREATE INDEX "AiCredit_tenantId_createdAt_idx" ON "AiCredit"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiCredit" ADD CONSTRAINT "AiCredit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security, as for every business table (see 20261031000000_row_level_security).
ALTER TABLE "AiCredit" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AiCredit"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'crm_app') THEN
    -- Read only for the app role: credit is added by the platform (the payment webhook, or the owner), never by a business's own request.
    EXECUTE 'GRANT SELECT ON "AiCredit" TO crm_app';
  END IF;
END
$$;
