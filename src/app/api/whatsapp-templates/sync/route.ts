import { ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { syncWhatsappTemplates } from "@/lib/whatsapp-templates";

export const dynamic = "force-dynamic";

/**
 * POST /api/whatsapp-templates/sync: copies the business's templates and their approval status from Meta (admins).
 * 409 when WhatsApp or the Business Account ID is not set up; 502 carries Meta's reason when it refuses.
 */
export const POST = authed(async ({ user }) => ok(await syncWhatsappTemplates(user.tenantId)), "ADMIN");
