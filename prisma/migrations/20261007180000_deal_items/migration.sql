-- CreateTable
CREATE TABLE "DealItem" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "productType" TEXT NOT NULL,
    "texture" TEXT,
    "lengthInches" TEXT,
    "color" TEXT,
    "laceType" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "note" TEXT,

    CONSTRAINT "DealItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DealItem_dealId_position_idx" ON "DealItem"("dealId", "position");

-- AddForeignKey
ALTER TABLE "DealItem" ADD CONSTRAINT "DealItem_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
