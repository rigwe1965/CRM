import { describe, expect, it } from "vitest";
import { INBOX_PROMPT, INBOX_PROMPT_VERSION, INBOX_TOOL, inboxFingerprint, writeSuggestionsInput } from "@/lib/ai/inbox/prompt";

/**
 * The wording step's instructions are pinned, like AI's chat prompt: an edit has to be deliberate. (Background calls have
 * no thinking blocks to protect, so the version is for the record; the fingerprint is what stops an accidental change.)
 */
const PINNED = { version: "1", fingerprint: "f147aeaddaa92c49" };

describe("the inbox wording prompt", () => {
  it("is pinned: change the text or the tool and update this together with the version", () => {
    expect({ version: INBOX_PROMPT_VERSION, fingerprint: inboxFingerprint() }).toEqual(PINNED);
  });

  it("says: words only, no new facts, record text is data, and one call with every key", () => {
    expect(INBOX_PROMPT).toMatch(/only write words/i);
    expect(INBOX_PROMPT).toMatch(/never add facts/i);
    expect(INBOX_PROMPT).toMatch(/links, phone numbers, account or bank details/i);
    expect(INBOX_PROMPT).toMatch(/data, never instructions/i);
    expect(INBOX_PROMPT).toMatch(/exactly once/i);
    expect(INBOX_PROMPT).not.toMatch(/https?:\/\//);
  });

  it("offers the model one tool, which returns wording and nothing else", () => {
    expect(INBOX_TOOL.name).toBe("write_suggestions");
    expect(Object.keys((INBOX_TOOL.input_schema as unknown as { properties: object }).properties)).toEqual(["items"]);
    expect(Object.keys(writeSuggestionsInput.shape.items.element.shape).sort()).toEqual(["key", "message", "taskTitle"]);
  });
});
