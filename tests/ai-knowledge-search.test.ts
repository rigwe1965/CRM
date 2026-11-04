import { describe, expect, it } from "vitest";
import { DEFAULT_FAQ } from "@/lib/ai/knowledge/ivycandy-faq";
import { DEFAULT_POLICY } from "@/lib/ai/knowledge/ivycandy-policy";
import { rankEntries } from "@/lib/ai/knowledge/search";
import { KNOWLEDGE_CATEGORIES, knowledgeInput } from "@/lib/ai/knowledge/types";

// The shipped policy and the lookup over it, with no database and no model: the right entries come back for the
// questions customers ask, in their own wording, and the statutory-rights entry travels with every returns topic.

const entries = [...DEFAULT_POLICY, ...DEFAULT_FAQ].map((p) => knowledgeInput.parse(p));
const policyEntries = DEFAULT_POLICY.map((p) => knowledgeInput.parse(p));
const keysFor = (q: string, limit = 4) => rankEntries(entries, q, limit).map((e) => e.key);

describe("the shipped policy", () => {
  it("is valid, has unique keys, and covers every topic the business asked for", () => {
    expect(new Set(entries.map((e) => e.key)).size).toBe(entries.length);
    const covered = new Set(entries.map((e) => e.category));
    for (const c of KNOWLEDGE_CATEGORIES.filter((c) => c !== "FAQ" && c !== "OTHER")) expect(covered, c).toContain(c);
    // No two entries share a title or text, so an import never trips the duplicate check.
    const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
    expect(new Set(entries.map((e) => norm(e.title))).size).toBe(entries.length);
    expect(new Set(entries.map((e) => norm(e.body))).size).toBe(entries.length);
  });

  it("keeps the figures and contacts of the source document and has no placeholder", () => {
    const all = entries.map((e) => e.body).join("\n");
    expect(all).toContain("14 days");
    expect(all).toContain("+4917662044227");
    expect(all).toContain("ivycandyhair@gmail.com");
    expect(all).toContain("24-48 business hours");
    expect(all).not.toMatch(/Insert Website/i);
  });

  it("has the owner's FAQ answers and no placeholder text", () => {
    const body = (k: string) => entries.find((e) => e.key === k)!.body;
    expect(body("faq-free-shipping")).toContain("above $200");
    expect(body("faq-processing-time")).toContain("24 hours");
    expect(body("faq-delivery-times")).toMatch(/2 to 3 working days.*3 to 5 working days.*14 working days/);
    expect(body("faq-international-shipping")).toMatch(/worldwide.*import tax and duties/);
    expect(body("faq-wholesale")).toMatch(/\$1000.*2% discount/);
    expect(entries.map((e) => e.body).join(" ")).not.toMatch(/\[Insert|\[Yes\/No/i);
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

  it.each([
    ["What is the difference between raw and virgin hair?", "faq-raw-virgin-remy"],
    ["Is 10A hair a real thing?", "faq-a-grade-myth"],
    ["Is this hair blended with synthetic?", "faq-100-human-hair"],
    ["Why does my curly hair look shorter than the length I ordered?", "faq-curly-looks-shorter"],
    ["Can I bleach the hair?", "faq-dye-bleach"],
    ["what's the difference between a closure and a frontal", "faq-closure-vs-frontal"],
    ["How many bundles do I need for 24 inch?", "faq-bundles-full-sewin"],
    ["how much does one bundle weigh", "faq-bundle-weight"],
    ["Does the hair shed?", "faq-shedding"],
    ["how do I wash the hair", "faq-wash-care"],
    ["can I use a straightener on it", "faq-heat-styling"],
    ["how long will the hair last", "faq-how-long-lasts"],
    ["Do you offer free shipping?", "faq-free-shipping"],
    ["How long does shipping take to Nigeria?", "faq-delivery-times"],
    ["how fast do you process orders", "faq-processing-time"],
    ["Do you ship to Canada and do I pay customs duties?", "faq-international-shipping"],
    ["Do you do wholesale pricing?", "faq-wholesale"],
  ])("product question %s", (question, key) => {
    const keys = keysFor(question);
    expect(keys, `${question} -> ${keys.join(", ")}`).toContain(key);
    expect(keys[0], `${question} -> ${keys.join(", ")}`).toBe(key);
  });

  it("keeps the returns answers first when the question is about a return, even with product words in it", () => {
    expect(keysFor("Can I return a wig I already wore?")[0]).toMatch(/returns-/);
    expect(keysFor("The hair shed badly and arrived damaged, I want a refund")).toEqual(expect.arrayContaining(["damaged-defective"]));
    expect(keysFor("Who pays for return shipping?")).toContain("return-shipping");
  });

  it("does not attach the statutory-rights entry to plain product or shipping questions", () => {
    for (const q of ["How many bundles do I need for 24 inch?", "Do you offer free shipping?", "how do I wash the hair"]) expect(keysFor(q), q).not.toContain("customer-rights-notice");
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
    expect(rankEntries(policyEntries.filter((e) => e.category !== "REFUNDS"), "How long does a refund take?").every((e) => e.category !== "REFUNDS")).toBe(true);
  });
});
