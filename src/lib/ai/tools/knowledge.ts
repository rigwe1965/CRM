import { z } from "zod";
import { defineTool } from "@/lib/ai/tools/types";
import { searchKnowledge } from "@/lib/ai/knowledge/search";

/** Looks up the business's own written policy and FAQs. Read-only, and only the caller's own business. */
export const findKnowledge = defineTool({
  name: "find_knowledge",
  description:
    "Look up the business's approved policy and FAQ entries (returns, refunds, exchanges, damaged or wrong orders, cancellations, delivery, return shipping, customer rights, support contact and hours). Use it for every question about what the business's policy is or what a customer is entitled to, in the customer's own words plus the topic of the conversation so far. Answer only from what it returns; if nothing fits, say the policy does not cover it and hand the case to a person.",
  schema: z.object({
    query: z.string().trim().min(2).max(400).describe("The customer's question in their own words, with the earlier topic if this is a follow-up, e.g. 'can I return a wig I already wore'."),
  }),
  label: () => "Checking the policy",
  fallbackLabel: "Checking the policy",
  run: async ({ owned }, i) => {
    const { total, results } = await searchKnowledge(owned.tenantId, i.query);
    return {
      entriesInKnowledgeBase: total,
      matches: results.map((e) => ({ title: e.title, category: e.category, basis: e.basis, text: e.body, updated: e.updatedAt.toISOString().slice(0, 10) })),
      note: total === 0 ? "The knowledge base is empty: an admin has not added the policy yet. Say you do not have the policy and involve a person." : results.length === 0 ? "No entry covers this. Do not answer from general knowledge; say the policy does not cover it and hand the case to a person." : undefined,
    };
  },
});
