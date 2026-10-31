-- Shipping status of a sold order, kept apart from the sales stage. Existing deals start as NOT_STARTED.

-- CreateEnum
CREATE TYPE "FulfilmentStatus" AS ENUM ('NOT_STARTED', 'PACKED', 'SHIPPED', 'DELIVERED', 'RETURNED');

-- AlterTable
ALTER TABLE "Deal"
  ADD COLUMN "fulfilmentStatus" "FulfilmentStatus" NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "carrier" TEXT,
  ADD COLUMN "trackingNumber" TEXT,
  ADD COLUMN "shippedAt" TIMESTAMP(3),
  ADD COLUMN "deliveredAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Deal_tenantId_fulfilmentStatus_idx" ON "Deal"("tenantId", "fulfilmentStatus");
