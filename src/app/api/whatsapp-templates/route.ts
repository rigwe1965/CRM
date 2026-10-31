import { db } from "@/lib/db";
import { ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { tenantScope } from "@/lib/access";
import { templateDto } from "@/lib/whatsapp-templates";

export const dynamic = "force-dynamic";

/** GET /api/whatsapp-templates: the business's WhatsApp templates copied from Meta, by name. Anyone signed in can read them. */
export const GET = authed(async ({ user }) => {
  const rows = await db.whatsappTemplate.findMany({ where: tenantScope(user), orderBy: [{ name: "asc" }, { language: "asc" }], take: 300 });
  return ok(rows.map(templateDto));
});
