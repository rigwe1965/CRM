-- Broadcast campaigns, phase 2 (sending): test send, confirmed size, pause reason and a batch lock.

-- AlterTable
ALTER TABLE "Campaign"
  ADD COLUMN "testedAt" TIMESTAMP(3),
  ADD COLUMN "audienceSize" INTEGER,
  ADD COLUMN "pausedReason" TEXT,
  ADD COLUMN "lockedUntil" TIMESTAMP(3);
