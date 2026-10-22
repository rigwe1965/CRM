-- Multi-tenancy Phase 1: a business table can no longer be written without naming its business. The default
-- that Phase 0 added (so existing rows and the unchanged app kept working) is removed; every create now passes
-- the caller's tenantId, and a forgotten one is a database error instead of a row filed under the wrong business.

ALTER TABLE "User" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "Organization" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "Contact" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "Deal" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "Activity" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "Task" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "Tag" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "ContactTag" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "SavedFilter" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "EmailTemplate" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "AutomationSetting" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "Invoice" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "InvoiceItem" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "Payment" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "PaymentLink" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "Instalment" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "InstalmentReminder" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "DealItem" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "StockAdjustment" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "AuditLog" ALTER COLUMN "tenantId" DROP DEFAULT;
