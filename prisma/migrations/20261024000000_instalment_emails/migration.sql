-- CreateEnum
CREATE TYPE "InstalmentReminderKind" AS ENUM ('UPCOMING', 'OVERDUE_1', 'OVERDUE_2');

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "emailOptOut" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "InstalmentReminder" (
    "id" TEXT NOT NULL,
    "instalmentId" TEXT NOT NULL,
    "kind" "InstalmentReminderKind" NOT NULL,
    "test" BOOLEAN NOT NULL DEFAULT false,
    "recipient" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstalmentReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InstalmentReminder_instalmentId_idx" ON "InstalmentReminder"("instalmentId");

-- CreateIndex
CREATE UNIQUE INDEX "InstalmentReminder_instalmentId_kind_test_key" ON "InstalmentReminder"("instalmentId", "kind", "test");

-- AddForeignKey
ALTER TABLE "InstalmentReminder" ADD CONSTRAINT "InstalmentReminder_instalmentId_fkey" FOREIGN KEY ("instalmentId") REFERENCES "Instalment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
