import { db } from "@/lib/db";
import { ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { notFound, tenantScope } from "@/lib/access";
import { organizationInclude } from "@/lib/includes";

export const dynamic = "force-dynamic";

/** POST /api/organizations/:id/restore: admin only. Undoes a soft delete. */
export const POST = authed<{ id: string }>(async ({ user, params }) => {
  const { count } = await db.organization.updateMany({
    where: { id: params.id, deletedAt: { not: null }, ...tenantScope(user) },
    data: { deletedAt: null },
  });
  if (count === 0) throw notFound("Deleted organization");
  return ok(await db.organization.findFirstOrThrow({ where: { id: params.id, ...tenantScope(user) }, include: organizationInclude }));
}, "ADMIN");
