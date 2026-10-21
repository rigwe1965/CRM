-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'WHATSAPP';

-- CreateEnum
CREATE TYPE "ActivityDirection" AS ENUM ('IN', 'OUT');

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "direction" "ActivityDirection";

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "phoneE164" TEXT;

-- Backfill: numbers already written in international form (+… or 00…). Others stay null until edited.
UPDATE "Contact"
SET "phoneE164" = '+' || regexp_replace(regexp_replace("phone", '^\s*(\+|00)', ''), '\D', '', 'g')
WHERE "phone" ~ '^\s*(\+|00)\s*[1-9]'
  AND length(regexp_replace(regexp_replace("phone", '^\s*(\+|00)', ''), '\D', '', 'g')) BETWEEN 8 AND 15;

-- CreateIndex
CREATE INDEX "Contact_phoneE164_idx" ON "Contact"("phoneE164");
