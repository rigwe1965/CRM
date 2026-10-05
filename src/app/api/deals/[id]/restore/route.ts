import { db } from "@/lib/db";
import { ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { dealInclude } from "@/lib/includes";
import { notFound } from "@/lib/access";
import { dealDto } from "@/lib/deals";

export const dynamic = "force-dynamic";

/** POST /api/deals/:id/restore: admin only. Undoes a soft delete. */
export const POST = authed<{ id: string }>(async ({ params }) => {
  const { count } = await db.deal.updateMany({
    where: { id: params.id, deletedAt: { not: null } },
    data: { deletedAt: null },
  });
  if (count === 0) throw notFound("Deleted deal");
  return ok(dealDto(await db.deal.findUniqueOrThrow({ where: { id: params.id }, include: dealInclude })));
}, "ADMIN");
