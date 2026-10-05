import { db } from "@/lib/db";
import { ApiError, ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { notFound, ownerScope } from "@/lib/access";
import { contactInclude } from "@/lib/includes";

export const dynamic = "force-dynamic";

/** POST /api/contacts/:id/convert: promote a lead/prospect to CUSTOMER (clears leadStatus). */
export const POST = authed<{ id: string }>(async ({ user, params }) => {
  const existing = await db.contact.findFirst({
    where: { id: params.id, deletedAt: null, ...ownerScope(user) },
    select: { type: true },
  });
  if (!existing) throw notFound("Contact");
  if (existing.type === "CUSTOMER") throw new ApiError(409, "Contact is already a customer", "ALREADY_CONVERTED");
  const contact = await db.contact.update({
    where: { id: params.id },
    data: { type: "CUSTOMER", leadStatus: null },
    include: contactInclude,
  });
  return ok(contact);
});
