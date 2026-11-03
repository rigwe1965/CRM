-- READ-ONLY. Lists every row that points at another business's row (40 links). Zero rows = clean.
-- Generated from prisma/schema.prisma; same check as scripts/audit-cross-tenant-links.ts.
-- Run as the owner role (e.g. the Neon SQL editor's default), which row-level security does not bind.
-- Only SELECT statements. Nothing is changed.

SELECT 'Activity.authorId -> User' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "Activity" c JOIN "User" p ON p."id" = c."authorId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'Activity.contactId -> Contact' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "Activity" c JOIN "Contact" p ON p."id" = c."contactId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'Activity.dealId -> Deal' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "Activity" c JOIN "Deal" p ON p."id" = c."dealId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'Activity.organizationId -> Organization' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "Activity" c JOIN "Organization" p ON p."id" = c."organizationId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'AiConversation.userId -> User' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "AiConversation" c JOIN "User" p ON p."id" = c."userId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'AiInboxRun.userId -> User' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "AiInboxRun" c JOIN "User" p ON p."id" = c."userId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'AiMessage.conversationId -> AiConversation' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "AiMessage" c JOIN "AiConversation" p ON p."id" = c."conversationId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'AiProposal.conversationId -> AiConversation' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "AiProposal" c JOIN "AiConversation" p ON p."id" = c."conversationId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'AiProposal.userId -> User' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "AiProposal" c JOIN "User" p ON p."id" = c."userId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'Campaign.createdById -> User' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "Campaign" c JOIN "User" p ON p."id" = c."createdById" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'Campaign.templateId -> WhatsappTemplate' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "Campaign" c JOIN "WhatsappTemplate" p ON p."id" = c."templateId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'CampaignRecipient.campaignId -> Campaign' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "CampaignRecipient" c JOIN "Campaign" p ON p."id" = c."campaignId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'CampaignRecipient.contactId -> Contact' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "CampaignRecipient" c JOIN "Contact" p ON p."id" = c."contactId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'Contact.organizationId -> Organization' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "Contact" c JOIN "Organization" p ON p."id" = c."organizationId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'Contact.ownerId -> User' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "Contact" c JOIN "User" p ON p."id" = c."ownerId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'ContactTag.contactId -> Contact' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "ContactTag" c JOIN "Contact" p ON p."id" = c."contactId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'ContactTag.tagId -> Tag' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "ContactTag" c JOIN "Tag" p ON p."id" = c."tagId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'CustomerOrderLink.createdById -> User' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "CustomerOrderLink" c JOIN "User" p ON p."id" = c."createdById" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'CustomerOrderLink.dealId -> Deal' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "CustomerOrderLink" c JOIN "Deal" p ON p."id" = c."dealId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'Deal.contactId -> Contact' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "Deal" c JOIN "Contact" p ON p."id" = c."contactId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'Deal.organizationId -> Organization' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "Deal" c JOIN "Organization" p ON p."id" = c."organizationId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'Deal.ownerId -> User' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "Deal" c JOIN "User" p ON p."id" = c."ownerId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'DealItem.dealId -> Deal' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "DealItem" c JOIN "Deal" p ON p."id" = c."dealId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'Instalment.dealId -> Deal' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "Instalment" c JOIN "Deal" p ON p."id" = c."dealId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'InstalmentReminder.instalmentId -> Instalment' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "InstalmentReminder" c JOIN "Instalment" p ON p."id" = c."instalmentId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'Invoice.ownerId -> User' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "Invoice" c JOIN "User" p ON p."id" = c."ownerId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'InvoiceItem.invoiceId -> Invoice' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "InvoiceItem" c JOIN "Invoice" p ON p."id" = c."invoiceId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'KnowledgeEntryVersion.entryId -> KnowledgeEntry' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "KnowledgeEntryVersion" c JOIN "KnowledgeEntry" p ON p."id" = c."entryId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'Organization.ownerId -> User' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "Organization" c JOIN "User" p ON p."id" = c."ownerId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'Payment.dealId -> Deal' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "Payment" c JOIN "Deal" p ON p."id" = c."dealId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'Payment.paymentLinkId -> PaymentLink' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "Payment" c JOIN "PaymentLink" p ON p."id" = c."paymentLinkId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'Payment.recordedById -> User' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "Payment" c JOIN "User" p ON p."id" = c."recordedById" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'PaymentLink.createdById -> User' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "PaymentLink" c JOIN "User" p ON p."id" = c."createdById" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'PaymentLink.dealId -> Deal' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "PaymentLink" c JOIN "Deal" p ON p."id" = c."dealId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'SavedFilter.userId -> User' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "SavedFilter" c JOIN "User" p ON p."id" = c."userId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'StockAdjustment.ownerId -> User' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "StockAdjustment" c JOIN "User" p ON p."id" = c."ownerId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'Task.assigneeId -> User' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "Task" c JOIN "User" p ON p."id" = c."assigneeId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'Task.contactId -> Contact' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "Task" c JOIN "Contact" p ON p."id" = c."contactId" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'Task.createdById -> User' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "Task" c JOIN "User" p ON p."id" = c."createdById" WHERE c."tenantId" <> p."tenantId"
UNION ALL
SELECT 'Task.dealId -> Deal' AS link, c.ctid::text AS row_address, c."tenantId" AS row_business, p."tenantId" AS points_at_business
  FROM "Task" c JOIN "Deal" p ON p."id" = c."dealId" WHERE c."tenantId" <> p."tenantId"
ORDER BY 1, 2;
