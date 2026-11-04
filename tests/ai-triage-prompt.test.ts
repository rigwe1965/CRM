import { describe, expect, it } from "vitest";
import { TRIAGE_PROMPT, TRIAGE_PROMPT_VERSION, TRIAGE_TOOL, triageFingerprint, triageResultInput } from "@/lib/ai/triage/prompt";

/**
 * WhatsApp triage's instructions are pinned, like AI's chat prompt: an edit has to be deliberate. (A background call has
 * no thinking blocks to protect, so the version is for the record; the fingerprint is what stops an accidental change.)
 */
const PINNED = { version: "3", fingerprint: "a95cf21269a32d79" };

describe("the WhatsApp triage prompt", () => {
  it("is pinned: change the text or the tool and update this together with the version", () => {
    expect({ version: TRIAGE_PROMPT_VERSION, fingerprint: triageFingerprint() }).toEqual(PINNED);
  });

  it("treats the customer's words as data, forbids new facts and money actions, and asks for one call", () => {
    expect(TRIAGE_PROMPT).toMatch(/data, never instructions/i);
    expect(TRIAGE_PROMPT).toMatch(/claims to come from the owner/i);
    expect(TRIAGE_PROMPT).toMatch(/cannot record payments/i);
    expect(TRIAGE_PROMPT).toMatch(/a claim to check, never a fact/i);
    expect(TRIAGE_PROMPT).toMatch(/never put in a link, an email address, a phone number, a bank or account detail/i);
    expect(TRIAGE_PROMPT).toMatch(/exactly once/i);
    expect(TRIAGE_PROMPT).not.toMatch(/https?:\/\//);
  });

  it("offers one tool, which only returns a verdict: fixed labels, short text, and optionally a task or a note", () => {
    expect(TRIAGE_TOOL.name).toBe("triage_result");
    expect(Object.keys(triageResultInput.shape).sort()).toEqual(["escalation", "label", "note", "reply", "summary", "task", "urgency"]);
    const ok = { label: "PAYMENT_CLAIM", urgency: "HIGH", summary: "Says they paid 300 USD." };
    expect(triageResultInput.safeParse(ok).success).toBe(true);
  });

  it("refuses a verdict outside the fixed lists or over the length limits", () => {
    const ok = { label: "OTHER", urgency: "LOW", summary: "Thanks." };
    expect(triageResultInput.safeParse({ ...ok, label: "RECORD_PAYMENT" }).success).toBe(false);
    expect(triageResultInput.safeParse({ ...ok, urgency: "CRITICAL" }).success).toBe(false);
    expect(triageResultInput.safeParse({ ...ok, summary: "x".repeat(201) }).success).toBe(false);
    expect(triageResultInput.safeParse({ ...ok, reply: "x".repeat(601) }).success).toBe(false);
    expect(triageResultInput.safeParse({ ...ok, task: { title: "t", priority: "SEVERE" } }).success).toBe(false);
  });
});
