import { z } from "zod";
import { ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { assertCanAsk } from "@/lib/ai/status";
import { chooseDeal } from "@/lib/ai/documents/payment";

export const dynamic = "force-dynamic";

const body = z.object({
  conversationId: z.string().trim().min(1).max(40),
  dealId: z.string().trim().min(1).max(40),
  draft: z.unknown(),
});

/**
 * POST /api/assistant/documents/payment { conversationId, dealId, draft }: the person chose the deal for a receipt AI
 * read but could not place for certain. Makes the Record a payment card. No model call and no cost; the draft is checked
 * again, the deal must be one the person can see, and the card goes through the same checks as a typed payment (the
 * deal's currency, the balance, duplicates, the payment-proposals switch).
 */
export const POST = authed(async ({ req, user }) => {
  const input = await readBody(req, body);
  await assertCanAsk(user);
  return ok(await chooseDeal(user, input));
});
