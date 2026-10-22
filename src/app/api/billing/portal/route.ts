import { ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { openPortal } from "@/lib/billing";

export const dynamic = "force-dynamic";

/** POST /api/billing/portal: returns Stripe's page for updating the card, changing plan or cancelling. */
export const POST = authed(async ({ user }) => ok({ url: await openPortal(user.tenantId) }), "ADMIN");
