-- WhatsApp payment reminders: a customer must opt in, and a reminder is recorded per channel, so the email
-- and the WhatsApp message for the same instalment and notice don't block each other.
ALTER TABLE "Contact" ADD COLUMN "whatsappOptIn" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "InstalmentReminder" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'EMAIL';

DROP INDEX "InstalmentReminder_instalmentId_kind_test_key";
CREATE UNIQUE INDEX "InstalmentReminder_instalmentId_kind_test_channel_key" ON "InstalmentReminder"("instalmentId", "kind", "test", "channel");
