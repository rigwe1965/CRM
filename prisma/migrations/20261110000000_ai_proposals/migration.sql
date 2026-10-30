-- Ivy proposals (AI_ASSISTANT_PLAN.md, Phase 2): what Ivy suggests and what the person decided. A proposal writes nothing to
-- the business by itself; only the person's approval does, through the same code as the screens.

-- CreateEnum
CREATE TYPE "AiProposalKind" AS ENUM ('TASK_CREATE', 'TASK_CHANGE', 'NOTE_CREATE', 'STAGE_CHANGE', 'MESSAGE_DRAFT');

-- CreateEnum
CREATE TYPE "AiProposalStatus" AS ENUM ('PENDING', 'APPLIED', 'DECLINED', 'EXPIRED', 'FAILED');

-- CreateTable
CREATE TABLE "AiProposal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "kind" "AiProposalKind" NOT NULL,
    "status" "AiProposalStatus" NOT NULL DEFAULT 'PENDING',
    "params" JSONB NOT NULL,
    "preview" JSONB NOT NULL,
    "resultEntity" TEXT,
    "resultId" TEXT,
    "failure" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "reportedAt" TIMESTAMP(3),

    CONSTRAINT "AiProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiProposal_tenantId_userId_status_createdAt_idx" ON "AiProposal"("tenantId", "userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AiProposal_conversationId_idx" ON "AiProposal"("conversationId");

-- CreateIndex
CREATE INDEX "AiProposal_createdAt_idx" ON "AiProposal"("createdAt");

-- AddForeignKey
ALTER TABLE "AiProposal" ADD CONSTRAINT "AiProposal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiProposal" ADD CONSTRAINT "AiProposal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiProposal" ADD CONSTRAINT "AiProposal_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security, as for every business table (see 20261031000000_row_level_security).
ALTER TABLE "AiProposal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AiProposal"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'crm_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "AiProposal" TO crm_app';
  END IF;
END
$$;
