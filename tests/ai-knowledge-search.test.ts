import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "@/lib/ai/knowledge/ivycandy-policy";
import { rankEntries } from "@/lib/ai/knowledge/search";
import { KNOWLEDGE_CATEGORIES, knowledgeInput } from "@/lib/ai/knowledge/types";

// The shipped policy and the lookup over it, with no database and no model: the right entries come back for the
// questions customers ask, in their own wording, and the statutory-rights entry travels with every returns topic.

const entries = DEFAULT_POLICY.map((p) => knowledgeInput.parse(p));
const keysFor = (q: string, limit = 4) => rankEntries(entries, q, limit).map((e) => e.key);

describe("the shipped policy", () => {
  it("is valid, has unique keys, and covers every topic the business asked for", () => {
    expect(new Set(entries.map((e) => e.key)).size).toBe(entries.length);
    const covered = new Set(entries.map((e) => e.category));
    for (const c of KNOWLEDGE_CATEGORIES.filter((c) => c !== "FAQ" && c !== "OTHER")) expect(covered, c).toContain(c);
  });

  it("keeps the figures and contacts of the source document and has no placeholder", () => {
    const all = entries.map((e) => e.body).join("\n");
    expect(all).toContain("14 days");
    expect(all).toContain("+4917662044227");
    expect(all).toContain("ivycandyhair@gmail.com");
    expect(all).toContain("24-48 business hours");
    expect(all).not.toMatch(/Insert Website/i);
  });

  it("states that opened packaging alone is never an automatic refusal", () => {
    expect(entries.find((e) => e.key === "returns-special-intro")!.body).toMatch(/must never be refused automatically/);
  });
});

describe("finding the right entries for a customer's words", () => {
  it.each([
    ["Can I return my wig?", ["returns-wigs", "returns-general"]],
    ["Can I exchange my hair bundles?", ["exchange-policy", "returns-bundles"]],
    ["I received the wrong hair length. What should I do?", ["wrong-missing-damaged"]],
    ["My wig arrived damaged. Can I get a refund?", ["damaged-defective", "refund-eligibility"]],
    ["Can I return hair after opening the package?", ["returns-special-intro"]],
    ["How long does a refund take?", ["refund-processing"]],
    ["Who pays for return shipping?", ["return-shipping"]],
    ["Can I cancel an order that has already been shipped?", ["order-cancellation"]],
    ["I want to change my hair texture", ["exchange-policy"]],
    ["My custom wig does not look like what I ordered. What can I do?", ["returns-custom-wigs"]],
    ["Where is my parcel? It never arrived", ["delivery-delays-lost"]],
    ["what time are you open on saturday", ["support-hours"]],
    ["I will take this to a lawyer, I know my rights", ["customer-rights-notice"]],
  ])("%s", (question, expected) => {
    const keys = keysFor(question);
    for (const k of expected) expect(keys, `${question} -> ${keys.join(", ")}`).toContain(k);
  });

  it("always adds the statutory-rights entry to a returns, refund or exchange topic", () => {
    for (const q of ["Can I return my wig?", "I want a refund", "swap my bundles for another length", "cancel my order"]) {
      expect(keysFor(q, 2), q).toContain("customer-rights-notice");
    }
  });

  it("finds nothing for a question the policy does not cover, instead of guessing", () => {
    expect(keysFor("Do you sell hair oil gift cards for my birthday party?")).toEqual([]);
    expect(keysFor("hello")).toEqual([]);
  });

  it("skips archived-style gaps: only the entries it is given are ever returned", () => {
    expect(rankEntries(entries.filter((e) => e.category !== "REFUNDS"), "How long does a refund take?").every((e) => e.category !== "REFUNDS")).toBe(true);
  });
});
