-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "automationKey" TEXT;

-- CreateTable
CREATE TABLE "AutomationSetting" (
    "key" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "Task_automationKey_idx" ON "Task"("automationKey");
