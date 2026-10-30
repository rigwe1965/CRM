-- Ivy Phase 1: remember which version of the assistant's instructions and tools a chat was started with, so a chat is
-- only continued while it still matches (the model's thinking blocks are only valid if the prompt and tools are unchanged).
-- Existing rows (none in practice: Phase 0 created no chats) get an empty version and are treated as out of date.
ALTER TABLE "AiConversation" ADD COLUMN "promptVersion" TEXT NOT NULL DEFAULT '';
