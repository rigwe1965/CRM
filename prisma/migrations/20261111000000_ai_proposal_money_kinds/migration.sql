-- Ivy proposals, Wave B (AI_ASSISTANT_PLAN.md): record a payment, create a contact, create a deal. Still only proposals:
-- nothing is written to the business until a person approves.

-- AlterEnum
ALTER TYPE "AiProposalKind" ADD VALUE 'PAYMENT_RECORD';
ALTER TYPE "AiProposalKind" ADD VALUE 'CONTACT_CREATE';
ALTER TYPE "AiProposalKind" ADD VALUE 'DEAL_CREATE';
