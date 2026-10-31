import { z } from "zod";

export const KNOWLEDGE_CATEGORIES = [
  "GENERAL_RETURNS", "ELIGIBILITY", "BUNDLES", "WIGS_CLOSURES", "CUSTOM_WIGS", "HYGIENE", "REFUNDS", "EXCHANGES", "DAMAGED", "WRONG_MISSING",
  "CANCELLATION", "DELIVERY", "RETURN_SHIPPING", "CUSTOMER_RIGHTS", "SUPPORT", "FAQ", "OTHER",
] as const;
export const KNOWLEDGE_BASES = ["STATUTORY", "VOLUNTARY", "PROCESS", "INFO"] as const;

/** What an admin (or the shipped default policy) provides for one entry. */
export const knowledgeInput = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,59}$/, "Use lowercase letters, numbers and dashes"),
  category: z.enum(KNOWLEDGE_CATEGORIES),
  title: z.string().trim().min(3, "Add a title").max(120),
  body: z.string().trim().min(10, "Write the answer").max(4000),
  basis: z.enum(KNOWLEDGE_BASES).default("INFO"),
  keywords: z.array(z.string().trim().toLowerCase().min(2).max(40)).max(40).default([]),
});
export type KnowledgeInput = z.input<typeof knowledgeInput>;

export const knowledgePatch = knowledgeInput.omit({ key: true }).partial().extend({ status: z.enum(["ACTIVE", "ARCHIVED"]).optional() });
