-- Ivy knowledge base: the business's written policy and FAQs, which Ivy looks up before answering or drafting a reply.
-- Entries are edited by an admin (every edit keeps the old text in KnowledgeEntryVersion) and archived, never deleted.

-- CreateTable
CREATE TABLE "KnowledgeEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "basis" TEXT NOT NULL DEFAULT 'INFO',
    "keywords" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "fromDefault" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeEntryVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "editedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeEntryVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeEntry_tenantId_key_key" ON "KnowledgeEntry"("tenantId", "key");
CREATE INDEX "KnowledgeEntry_tenantId_status_category_idx" ON "KnowledgeEntry"("tenantId", "status", "category");
CREATE UNIQUE INDEX "KnowledgeEntryVersion_entryId_version_key" ON "KnowledgeEntryVersion"("entryId", "version");
CREATE INDEX "KnowledgeEntryVersion_tenantId_entryId_idx" ON "KnowledgeEntryVersion"("tenantId", "entryId");

-- AddForeignKey
ALTER TABLE "KnowledgeEntry" ADD CONSTRAINT "KnowledgeEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgeEntryVersion" ADD CONSTRAINT "KnowledgeEntryVersion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgeEntryVersion" ADD CONSTRAINT "KnowledgeEntryVersion_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "KnowledgeEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security, as for every business table (see 20261031000000_row_level_security).
ALTER TABLE "KnowledgeEntry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "KnowledgeEntry"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE "KnowledgeEntryVersion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "KnowledgeEntryVersion"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'crm_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "KnowledgeEntry" TO crm_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "KnowledgeEntryVersion" TO crm_app';
  END IF;
END
$$;
