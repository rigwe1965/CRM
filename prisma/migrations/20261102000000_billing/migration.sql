-- Phase 4 of MULTI_TENANCY_PLAN.md: a business can sign itself up and pay for a plan.

-- A signup waits as PENDING until its admin confirms their email.
ALTER TYPE "TenantStatus" ADD VALUE 'PENDING';

CREATE TYPE "BillingStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED');

-- Existing businesses (the original one) stay ACTIVE on their internal plan.
ALTER TABLE "Tenant"
  ADD COLUMN "billingStatus" "BillingStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "trialEndsAt" TIMESTAMP(3),
  ADD COLUMN "stripeCustomerId" TEXT,
  ADD COLUMN "stripeSubscriptionId" TEXT,
  ADD COLUMN "currentPeriodEnd" TIMESTAMP(3),
  ADD COLUMN "billingEventAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Tenant_stripeCustomerId_key" ON "Tenant"("stripeCustomerId");
CREATE UNIQUE INDEX "Tenant_stripeSubscriptionId_key" ON "Tenant"("stripeSubscriptionId");

-- A business's admin may edit how it presents itself, and nothing else on the Tenant row (billing is written by the
-- platform only; "updatedAt" is the column Prisma refreshes on every update). The existing row-level policy already
-- limits the update to the business's own row.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'crm_app') THEN
    EXECUTE 'GRANT UPDATE ("name", "brandName", "senderName", "updatedAt") ON "Tenant" TO crm_app';
  END IF;
END
$$;
