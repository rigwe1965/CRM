-- Multi-tenancy Phase 1: names that had to be unique across the whole database are now unique within a business,
-- so two businesses can each have a contact with the same email, a tag with the same name, an invoice with the
-- same number, and so on. User.email stays unique across the database (one user belongs to one business).

DROP INDEX "Organization_domain_key";
CREATE UNIQUE INDEX "Organization_tenantId_domain_key" ON "Organization"("tenantId", "domain");

DROP INDEX "Contact_email_key";
CREATE UNIQUE INDEX "Contact_tenantId_email_key" ON "Contact"("tenantId", "email");

DROP INDEX "Tag_name_key";
CREATE UNIQUE INDEX "Tag_tenantId_name_key" ON "Tag"("tenantId", "name");

DROP INDEX "EmailTemplate_name_key";
CREATE UNIQUE INDEX "EmailTemplate_tenantId_name_key" ON "EmailTemplate"("tenantId", "name");

DROP INDEX "Invoice_number_key";
CREATE UNIQUE INDEX "Invoice_tenantId_number_key" ON "Invoice"("tenantId", "number");

-- The setting's key was the primary key; it is now the key within a business.
ALTER TABLE "AutomationSetting" DROP CONSTRAINT "AutomationSetting_pkey";
ALTER TABLE "AutomationSetting" ADD CONSTRAINT "AutomationSetting_pkey" PRIMARY KEY ("tenantId", "key");
