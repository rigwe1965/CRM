-- Ivy, Phase 3c (AI_ASSISTANT_PLAN.md): triage of incoming WhatsApp messages. A new proposal kind (mark a customer as
-- opted out of WhatsApp, on a person's approval) and the queue table that makes each message triaged once. Nothing
-- happens until an admin turns triage on.

-- AlterEnum
ALTER TYPE "AiProposalKind" ADD VALUE 'CONTACT_OPT_OUT';

-- CreateTable
CREATE TABLE "AiTriage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "skipReason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "modelCalled" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT,
    "urgency" TEXT,
    "summary" TEXT,
    "cards" INTEGER NOT NULL DEFAULT 0,
    "costMicros" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AiTriage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiTriage_tenantId_activityId_key" ON "AiTriage"("tenantId", "activityId");
CREATE INDEX "AiTriage_tenantId_createdAt_idx" ON "AiTriage"("tenantId", "createdAt");
CREATE INDEX "AiTriage_tenantId_contactId_createdAt_idx" ON "AiTriage"("tenantId", "contactId", "createdAt");
CREATE INDEX "AiTriage_status_createdAt_idx" ON "AiTriage"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "AiTriage" ADD CONSTRAINT "AiTriage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security, as for every business table (see 20261031000000_row_level_security).
ALTER TABLE "AiTriage" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AiTriage"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'crm_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "AiTriage" TO crm_app';
  END IF;
END
$$;
