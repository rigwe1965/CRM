-- When a business claimed its sending domain, so a claim that is never verified can lapse and free the name for its
-- real owner. Written only by the server as the platform, like the other sender columns (no grant is added).
ALTER TABLE "Tenant" ADD COLUMN "senderClaimedAt" TIMESTAMP(3);

-- Claims that exist today and are not verified start their 7 days now.
UPDATE "Tenant" SET "senderClaimedAt" = now() WHERE "senderDomain" IS NOT NULL AND "senderVerifiedAt" IS NULL;
