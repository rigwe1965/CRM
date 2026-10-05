import { db } from "@/lib/db";
import { ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { notFound } from "@/lib/access";
import { contactInclude } from "@/lib/includes";

export const dynamic = "force-dynamic";

/** POST /api/contacts/:id/restore: admin only. Undoes a soft delete. */
export const POST = authed<{ id: string }>(async ({ params }) => {
  const { count } = await db.contact.updateMany({
    where: { id: params.id, deletedAt: { not: null } },
    data: { deletedAt: null },
  });
  if (count === 0) throw notFound("Deleted contact");
  return ok(await db.contact.findUniqueOrThrow({ where: { id: params.id }, include: contactInclude }));
}, "ADMIN");
