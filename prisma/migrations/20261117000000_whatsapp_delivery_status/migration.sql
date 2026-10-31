-- What Meta reports about an outgoing WhatsApp message after it leaves us: sent, delivered, read or failed (with its reason).
-- Null until Meta reports. "Activity" already has row-level security and grants.

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN "deliveryStatus" TEXT,
ADD COLUMN "deliveryError" TEXT;
