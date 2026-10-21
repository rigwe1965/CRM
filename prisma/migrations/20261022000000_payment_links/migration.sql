-- CreateEnum
CREATE TYPE "PaymentSource" AS ENUM ('MANUAL', 'ONLINE');

-- CreateEnum
CREATE TYPE "PaymentLinkStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED', 'REFUND_NEEDED');

-- AlterTable: online payments have no human recorder
ALTER TABLE "Payment" ALTER COLUMN "recordedById" DROP NOT NULL,
ADD COLUMN     "paymentLinkId" TEXT,
ADD COLUMN     "providerRef" TEXT,
ADD COLUMN     "source" "PaymentSource" NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "PaymentLink" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PaymentLinkStatus" NOT NULL DEFAULT 'PENDING',
    "providerLinkId" TEXT,
    "url" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "PaymentLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentLink_providerLinkId_key" ON "PaymentLink"("providerLinkId");

-- CreateIndex
CREATE INDEX "PaymentLink_dealId_status_idx" ON "PaymentLink"("dealId", "status");

-- CreateIndex
CREATE INDEX "PaymentLink_createdById_idx" ON "PaymentLink"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerRef_key" ON "Payment"("providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paymentLinkId_key" ON "Payment"("paymentLinkId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_paymentLinkId_fkey" FOREIGN KEY ("paymentLinkId") REFERENCES "PaymentLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
