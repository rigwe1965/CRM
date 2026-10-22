import { db } from "@/lib/db";
import { ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { notFound, tenantScope } from "@/lib/access";
import { contactInclude } from "@/lib/includes";

export const dynamic = "force-dynamic";

/** POST /api/contacts/:id/restore: admin only. Undoes a soft delete. */
export const POST = authed<{ id: string }>(async ({ user, params }) => {
  const { count } = await db.contact.updateMany({
    where: { id: params.id, deletedAt: { not: null }, ...tenantScope(user) },
    data: { deletedAt: null },
  });
  if (count === 0) throw notFound("Deleted contact");
  return ok(await db.contact.findFirstOrThrow({ where: { id: params.id, ...tenantScope(user) }, include: contactInclude }));
}, "ADMIN");
