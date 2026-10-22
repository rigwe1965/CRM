-- Phase 0 of MULTI_TENANCY_PLAN.md: every business table gets a tenantId.
--
-- Existing data all belongs to the one existing business, "tenant_ivycandy", created here. The column is
-- NOT NULL with that value as its DEFAULT, so (a) existing rows are filled without being rewritten (the
-- append-only AuditLog refuses UPDATE, and a constant default needs none) and (b) the app keeps working
-- unchanged until Phase 1 makes every create pass a tenant explicitly and drops the default.
--
-- AuditLog has no foreign key on purpose: its entries must outlive the records they refer to.
-- Account, Session and VerificationToken have no tenantId: they belong to a user, who carries it.

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "plan" TEXT NOT NULL DEFAULT 'internal',
    "brandName" TEXT,
    "senderName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- The existing business. Must exist before any tenantId column (and its foreign key) is added.
INSERT INTO "Tenant" ("id", "name", "slug", "updatedAt") VALUES ('tenant_ivycandy', 'Ivycandy Hair', 'ivycandy', CURRENT_TIMESTAMP);

-- User
ALTER TABLE "User" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'tenant_ivycandy';
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Organization
ALTER TABLE "Organization" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'tenant_ivycandy';
CREATE INDEX "Organization_tenantId_idx" ON "Organization"("tenantId");
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Contact
ALTER TABLE "Contact" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'tenant_ivycandy';
CREATE INDEX "Contact_tenantId_idx" ON "Contact"("tenantId");
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Deal
ALTER TABLE "Deal" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'tenant_ivycandy';
CREATE INDEX "Deal_tenantId_idx" ON "Deal"("tenantId");
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Activity
ALTER TABLE "Activity" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'tenant_ivycandy';
CREATE INDEX "Activity_tenantId_idx" ON "Activity"("tenantId");
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Task
ALTER TABLE "Task" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'tenant_ivycandy';
CREATE INDEX "Task_tenantId_idx" ON "Task"("tenantId");
ALTER TABLE "Task" ADD CONSTRAINT "Task_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tag
ALTER TABLE "Tag" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'tenant_ivycandy';
CREATE INDEX "Tag_tenantId_idx" ON "Tag"("tenantId");
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ContactTag
ALTER TABLE "ContactTag" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'tenant_ivycandy';
CREATE INDEX "ContactTag_tenantId_idx" ON "ContactTag"("tenantId");
ALTER TABLE "ContactTag" ADD CONSTRAINT "ContactTag_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SavedFilter
ALTER TABLE "SavedFilter" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'tenant_ivycandy';
CREATE INDEX "SavedFilter_tenantId_idx" ON "SavedFilter"("tenantId");
ALTER TABLE "SavedFilter" ADD CONSTRAINT "SavedFilter_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- EmailTemplate
ALTER TABLE "EmailTemplate" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'tenant_ivycandy';
CREATE INDEX "EmailTemplate_tenantId_idx" ON "EmailTemplate"("tenantId");
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AutomationSetting
ALTER TABLE "AutomationSetting" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'tenant_ivycandy';
CREATE INDEX "AutomationSetting_tenantId_idx" ON "AutomationSetting"("tenantId");
ALTER TABLE "AutomationSetting" ADD CONSTRAINT "AutomationSetting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invoice
ALTER TABLE "Invoice" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'tenant_ivycandy';
CREATE INDEX "Invoice_tenantId_idx" ON "Invoice"("tenantId");
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- InvoiceItem
ALTER TABLE "InvoiceItem" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'tenant_ivycandy';
CREATE INDEX "InvoiceItem_tenantId_idx" ON "InvoiceItem"("tenantId");
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Payment
ALTER TABLE "Payment" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'tenant_ivycandy';
CREATE INDEX "Payment_tenantId_idx" ON "Payment"("tenantId");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PaymentLink
ALTER TABLE "PaymentLink" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'tenant_ivycandy';
CREATE INDEX "PaymentLink_tenantId_idx" ON "PaymentLink"("tenantId");
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Instalment
ALTER TABLE "Instalment" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'tenant_ivycandy';
CREATE INDEX "Instalment_tenantId_idx" ON "Instalment"("tenantId");
ALTER TABLE "Instalment" ADD CONSTRAINT "Instalment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- InstalmentReminder
ALTER TABLE "InstalmentReminder" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'tenant_ivycandy';
CREATE INDEX "InstalmentReminder_tenantId_idx" ON "InstalmentReminder"("tenantId");
ALTER TABLE "InstalmentReminder" ADD CONSTRAINT "InstalmentReminder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DealItem
ALTER TABLE "DealItem" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'tenant_ivycandy';
CREATE INDEX "DealItem_tenantId_idx" ON "DealItem"("tenantId");
ALTER TABLE "DealItem" ADD CONSTRAINT "DealItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- StockAdjustment
ALTER TABLE "StockAdjustment" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'tenant_ivycandy';
CREATE INDEX "StockAdjustment_tenantId_idx" ON "StockAdjustment"("tenantId");
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AuditLog (no foreign key, see above)
ALTER TABLE "AuditLog" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'tenant_ivycandy';
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");
