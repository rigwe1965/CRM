-- The database refuses a link from one business's row to another business's row.
--
-- Row-level security stops a business reading or writing another's rows, but a foreign key is checked by the database
-- without it, so a row could still point at another business's row; until now only the application (assertLinks,
-- assertTags) prevented that. Each trigger below checks, on INSERT and whenever the link column or "tenantId" is
-- written, that the row it points at exists in the same business. A NULL link passes. It compares "tenantId"
-- explicitly, so it holds for the restricted app role and for the owner / platform client alike.
--
-- It only inspects new writes: existing rows are never touched, so applying this cannot fail on old data, and an
-- UPDATE that writes neither a link column nor "tenantId" does not fire it. Run scripts/audit-cross-tenant-links.ts
-- (read-only) to list any existing cross-business links. See CROSS_TENANT_LINKS_PLAN.md.
--
-- A new foreign key from one business table to another needs its own trigger: tests/same-tenant-links.test.ts fails
-- until it has one.
--
-- Rollback: for each trigger below, DROP TRIGGER "same_tenant_<column>" ON "<table>"; then DROP FUNCTION enforce_same_tenant();

CREATE OR REPLACE FUNCTION enforce_same_tenant() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  ref_table text := TG_ARGV[0];
  link_col  text := TG_ARGV[1];
  target    text := to_jsonb(NEW) ->> link_col;
  ok        boolean;
BEGIN
  IF target IS NULL THEN
    RETURN NEW;
  END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE "id" = $1 AND "tenantId" = $2)', ref_table)
    INTO ok USING target, NEW."tenantId";
  IF NOT ok THEN
    RAISE EXCEPTION '%.% must point at a % of the same business', TG_TABLE_NAME, link_col, ref_table
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER "same_tenant_authorId"
  BEFORE INSERT OR UPDATE OF "authorId", "tenantId" ON "Activity"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('User', 'authorId');

CREATE TRIGGER "same_tenant_contactId"
  BEFORE INSERT OR UPDATE OF "contactId", "tenantId" ON "Activity"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('Contact', 'contactId');

CREATE TRIGGER "same_tenant_dealId"
  BEFORE INSERT OR UPDATE OF "dealId", "tenantId" ON "Activity"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('Deal', 'dealId');

CREATE TRIGGER "same_tenant_organizationId"
  BEFORE INSERT OR UPDATE OF "organizationId", "tenantId" ON "Activity"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('Organization', 'organizationId');

CREATE TRIGGER "same_tenant_userId"
  BEFORE INSERT OR UPDATE OF "userId", "tenantId" ON "AiConversation"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('User', 'userId');

CREATE TRIGGER "same_tenant_userId"
  BEFORE INSERT OR UPDATE OF "userId", "tenantId" ON "AiInboxRun"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('User', 'userId');

CREATE TRIGGER "same_tenant_conversationId"
  BEFORE INSERT OR UPDATE OF "conversationId", "tenantId" ON "AiMessage"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('AiConversation', 'conversationId');

CREATE TRIGGER "same_tenant_conversationId"
  BEFORE INSERT OR UPDATE OF "conversationId", "tenantId" ON "AiProposal"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('AiConversation', 'conversationId');

CREATE TRIGGER "same_tenant_userId"
  BEFORE INSERT OR UPDATE OF "userId", "tenantId" ON "AiProposal"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('User', 'userId');

CREATE TRIGGER "same_tenant_createdById"
  BEFORE INSERT OR UPDATE OF "createdById", "tenantId" ON "Campaign"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('User', 'createdById');

CREATE TRIGGER "same_tenant_templateId"
  BEFORE INSERT OR UPDATE OF "templateId", "tenantId" ON "Campaign"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('WhatsappTemplate', 'templateId');

CREATE TRIGGER "same_tenant_campaignId"
  BEFORE INSERT OR UPDATE OF "campaignId", "tenantId" ON "CampaignRecipient"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('Campaign', 'campaignId');

CREATE TRIGGER "same_tenant_contactId"
  BEFORE INSERT OR UPDATE OF "contactId", "tenantId" ON "CampaignRecipient"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('Contact', 'contactId');

CREATE TRIGGER "same_tenant_organizationId"
  BEFORE INSERT OR UPDATE OF "organizationId", "tenantId" ON "Contact"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('Organization', 'organizationId');

CREATE TRIGGER "same_tenant_ownerId"
  BEFORE INSERT OR UPDATE OF "ownerId", "tenantId" ON "Contact"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('User', 'ownerId');

CREATE TRIGGER "same_tenant_contactId"
  BEFORE INSERT OR UPDATE OF "contactId", "tenantId" ON "ContactTag"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('Contact', 'contactId');

CREATE TRIGGER "same_tenant_tagId"
  BEFORE INSERT OR UPDATE OF "tagId", "tenantId" ON "ContactTag"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('Tag', 'tagId');

CREATE TRIGGER "same_tenant_createdById"
  BEFORE INSERT OR UPDATE OF "createdById", "tenantId" ON "CustomerOrderLink"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('User', 'createdById');

CREATE TRIGGER "same_tenant_dealId"
  BEFORE INSERT OR UPDATE OF "dealId", "tenantId" ON "CustomerOrderLink"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('Deal', 'dealId');

CREATE TRIGGER "same_tenant_contactId"
  BEFORE INSERT OR UPDATE OF "contactId", "tenantId" ON "Deal"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('Contact', 'contactId');

CREATE TRIGGER "same_tenant_organizationId"
  BEFORE INSERT OR UPDATE OF "organizationId", "tenantId" ON "Deal"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('Organization', 'organizationId');

CREATE TRIGGER "same_tenant_ownerId"
  BEFORE INSERT OR UPDATE OF "ownerId", "tenantId" ON "Deal"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('User', 'ownerId');

CREATE TRIGGER "same_tenant_dealId"
  BEFORE INSERT OR UPDATE OF "dealId", "tenantId" ON "DealItem"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('Deal', 'dealId');

CREATE TRIGGER "same_tenant_dealId"
  BEFORE INSERT OR UPDATE OF "dealId", "tenantId" ON "Instalment"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('Deal', 'dealId');

CREATE TRIGGER "same_tenant_instalmentId"
  BEFORE INSERT OR UPDATE OF "instalmentId", "tenantId" ON "InstalmentReminder"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('Instalment', 'instalmentId');

CREATE TRIGGER "same_tenant_ownerId"
  BEFORE INSERT OR UPDATE OF "ownerId", "tenantId" ON "Invoice"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('User', 'ownerId');

CREATE TRIGGER "same_tenant_invoiceId"
  BEFORE INSERT OR UPDATE OF "invoiceId", "tenantId" ON "InvoiceItem"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('Invoice', 'invoiceId');

CREATE TRIGGER "same_tenant_entryId"
  BEFORE INSERT OR UPDATE OF "entryId", "tenantId" ON "KnowledgeEntryVersion"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('KnowledgeEntry', 'entryId');

CREATE TRIGGER "same_tenant_ownerId"
  BEFORE INSERT OR UPDATE OF "ownerId", "tenantId" ON "Organization"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('User', 'ownerId');

CREATE TRIGGER "same_tenant_dealId"
  BEFORE INSERT OR UPDATE OF "dealId", "tenantId" ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('Deal', 'dealId');

CREATE TRIGGER "same_tenant_paymentLinkId"
  BEFORE INSERT OR UPDATE OF "paymentLinkId", "tenantId" ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('PaymentLink', 'paymentLinkId');

CREATE TRIGGER "same_tenant_recordedById"
  BEFORE INSERT OR UPDATE OF "recordedById", "tenantId" ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('User', 'recordedById');

CREATE TRIGGER "same_tenant_createdById"
  BEFORE INSERT OR UPDATE OF "createdById", "tenantId" ON "PaymentLink"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('User', 'createdById');

CREATE TRIGGER "same_tenant_dealId"
  BEFORE INSERT OR UPDATE OF "dealId", "tenantId" ON "PaymentLink"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('Deal', 'dealId');

CREATE TRIGGER "same_tenant_userId"
  BEFORE INSERT OR UPDATE OF "userId", "tenantId" ON "SavedFilter"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('User', 'userId');

CREATE TRIGGER "same_tenant_ownerId"
  BEFORE INSERT OR UPDATE OF "ownerId", "tenantId" ON "StockAdjustment"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('User', 'ownerId');

CREATE TRIGGER "same_tenant_assigneeId"
  BEFORE INSERT OR UPDATE OF "assigneeId", "tenantId" ON "Task"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('User', 'assigneeId');

CREATE TRIGGER "same_tenant_contactId"
  BEFORE INSERT OR UPDATE OF "contactId", "tenantId" ON "Task"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('Contact', 'contactId');

CREATE TRIGGER "same_tenant_createdById"
  BEFORE INSERT OR UPDATE OF "createdById", "tenantId" ON "Task"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('User', 'createdById');

CREATE TRIGGER "same_tenant_dealId"
  BEFORE INSERT OR UPDATE OF "dealId", "tenantId" ON "Task"
  FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant('Deal', 'dealId');
