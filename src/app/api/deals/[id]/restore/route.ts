import { db } from "@/lib/db";
import { ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { dealInclude } from "@/lib/includes";
import { notFound, tenantScope } from "@/lib/access";
import { dealDto } from "@/lib/deals";

export const dynamic = "force-dynamic";

/** POST /api/deals/:id/restore: admin only. Undoes a soft delete. */
export const POST = authed<{ id: string }>(async ({ user, params }) => {
  const { count } = await db.deal.updateMany({
    where: { id: params.id, deletedAt: { not: null }, ...tenantScope(user) },
    data: { deletedAt: null },
  });
  if (count === 0) throw notFound("Deleted deal");
  return ok(dealDto(await db.deal.findFirstOrThrow({ where: { id: params.id, ...tenantScope(user) }, include: dealInclude })));
}, "ADMIN");
