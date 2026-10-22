import { z } from "zod";
import { ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { startCheckout } from "@/lib/billing";
import { PAID_PLANS } from "@/lib/plans";

export const dynamic = "force-dynamic";

/** POST /api/billing/checkout { plan }: returns the Stripe page where the business subscribes. Allowed while read-only (that is how it gets out). */
export const POST = authed(async ({ req, user }) => {
  const { plan } = await readBody(req, z.object({ plan: z.enum(PAID_PLANS) }));
  return ok({ url: await startCheckout({ id: user.id, tenantId: user.tenantId, email: user.email }, plan) });
}, "ADMIN");
