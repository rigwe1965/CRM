import { ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { integrationsView } from "@/lib/integrations-view";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/integrations: whether the business's Stripe, WhatsApp and website form are set up, where each
 * setting comes from, and the addresses to give the outside service. Secrets are write-only: they are never returned.
 */
export const GET = authed(async ({ user }) => ok(await integrationsView(user.tenantId)), "ADMIN");
