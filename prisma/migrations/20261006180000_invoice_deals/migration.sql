-- CreateTable
CREATE TABLE "_DealToInvoice" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_DealToInvoice_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_DealToInvoice_B_index" ON "_DealToInvoice"("B");

-- AddForeignKey
ALTER TABLE "_DealToInvoice" ADD CONSTRAINT "_DealToInvoice_A_fkey" FOREIGN KEY ("A") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DealToInvoice" ADD CONSTRAINT "_DealToInvoice_B_fkey" FOREIGN KEY ("B") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
