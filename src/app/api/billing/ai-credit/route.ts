import { z } from "zod";
import { ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { PACK_IDS, startCreditCheckout } from "@/lib/ai/credit-packs";

export const dynamic = "force-dynamic";

/** POST /api/billing/ai-credit { pack }: returns the Stripe page where an admin buys a pack of AI credit. */
export const POST = authed(async ({ req, user }) => {
  const { pack } = await readBody(req, z.object({ pack: z.enum(PACK_IDS) }));
  return ok({ url: await startCreditCheckout({ id: user.id, tenantId: user.tenantId, email: user.email }, pack) });
}, "ADMIN");
