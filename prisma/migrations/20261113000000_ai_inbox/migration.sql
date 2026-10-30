-- Ivy, Phase 3b (AI_ASSISTANT_PLAN.md): the daily "Suggested actions" inbox. Proposals can now exist without a chat,
-- with a source, a reason and a dedupe key; a run log makes a day's suggestions happen once per person; usage records
-- what a call was for; people can mute the suggestions. Nothing is made until an admin turns the inbox on.

-- CreateEnum
CREATE TYPE "AiProposalSource" AS ENUM ('CHAT', 'DAILY', 'WHATSAPP');

-- AlterTable
ALTER TABLE "AiProposal" ALTER COLUMN "conversationId" DROP NOT NULL;
ALTER TABLE "AiProposal" ADD COLUMN "source" "AiProposalSource" NOT NULL DEFAULT 'CHAT';
ALTER TABLE "AiProposal" ADD COLUMN "dedupeKey" TEXT;
ALTER TABLE "AiProposal" ADD COLUMN "reason" TEXT;
ALTER TABLE "AiProposal" ADD COLUMN "subjectType" TEXT;
ALTER TABLE "AiProposal" ADD COLUMN "subjectId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AiProposal_tenantId_userId_dedupeKey_key" ON "AiProposal"("tenantId", "userId", "dedupeKey");
CREATE INDEX "AiProposal_tenantId_userId_source_status_idx" ON "AiProposal"("tenantId", "userId", "source", "status");

-- AlterTable
ALTER TABLE "AiUsage" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'CHAT';

-- AlterTable
ALTER TABLE "User" ADD COLUMN "aiSuggestionsMuted" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AiInboxRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "candidates" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "costMicros" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AiInboxRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiInboxRun_tenantId_userId_day_key" ON "AiInboxRun"("tenantId", "userId", "day");
CREATE INDEX "AiInboxRun_startedAt_idx" ON "AiInboxRun"("startedAt");

-- AddForeignKey
ALTER TABLE "AiInboxRun" ADD CONSTRAINT "AiInboxRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiInboxRun" ADD CONSTRAINT "AiInboxRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security, as for every business table (see 20261031000000_row_level_security).
ALTER TABLE "AiInboxRun" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AiInboxRun"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'crm_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "AiInboxRun" TO crm_app';
  END IF;
END
$$;
