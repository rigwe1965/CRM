import { z } from "zod";
import { ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { assertCanAsk } from "@/lib/ai/status";
import { chooseCustomer } from "@/lib/ai/documents/order";

export const dynamic = "force-dynamic";

const body = z.object({
  conversationId: z.string().trim().min(1).max(40),
  contactId: z.string().trim().min(1).max(40),
  draft: z.unknown(),
});

/**
 * POST /api/assistant/documents/order { conversationId, contactId, draft }: the person chose the customer for an order
 * Ivy read but could not match for certain. Makes the Create a deal card. No model call and no cost; the draft is checked
 * again with the same rules as when it was read, and the contact must be one the person can see.
 */
export const POST = authed(async ({ req, user }) => {
  const input = await readBody(req, body);
  await assertCanAsk(user);
  return ok(await chooseCustomer(user, input));
});
