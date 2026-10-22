-- A business can send the mail it triggers for its customers from its own verified domain.
-- Written only by the server as the platform (never by the app role: no grant is added), so a business can't mark a
-- domain verified itself.
ALTER TABLE "Tenant" ADD COLUMN "senderDomain" TEXT,
ADD COLUMN "senderLocalPart" TEXT,
ADD COLUMN "senderDomainId" TEXT,
ADD COLUMN "senderVerifiedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Tenant_senderDomain_key" ON "Tenant"("senderDomain");
