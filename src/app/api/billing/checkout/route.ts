import { z } from "zod";
import { ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { BILLING_CURRENCIES, startCheckout } from "@/lib/billing";
import { PAID_PLANS } from "@/lib/plans";

export const dynamic = "force-dynamic";

/** POST /api/billing/checkout { plan, currency? }: returns the Stripe page where the business subscribes. Allowed while read-only (that is how it gets out). */
export const POST = authed(async ({ req, user }) => {
  const { plan, currency } = await readBody(req, z.object({ plan: z.enum(PAID_PLANS), currency: z.enum(BILLING_CURRENCIES).optional() }));
  return ok({ url: await startCheckout({ id: user.id, tenantId: user.tenantId, email: user.email }, plan, currency) });
}, "ADMIN");
