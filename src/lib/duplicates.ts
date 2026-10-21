import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";

export type DuplicateMatch = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  type: string;
  /** Why it was flagged, in words for the screen. */
  reasons: string[];
};

/**
 * Finds live contacts that look like the one described. Same email is already blocked by a unique index, so
 * this checks the cases that slip through: the same phone number (compared as E.164, so "+49 159 0646 2275" and
 * "0049 1590646 2275" count as one), or the same first + last name in any capitals.
 * `scope` is the caller's owner scope, so a sales user is only told about contacts they can open.
 */
export async function findDuplicates(
  scope: Prisma.ContactWhereInput,
  q: { firstName?: string; lastName?: string; phone?: string; email?: string; excludeId?: string },
): Promise<DuplicateMatch[]> {
  const e164 = normalizePhone(q.phone);
  const hasName = !!q.firstName && !!q.lastName;
  const email = q.email?.trim();
  const or: Prisma.ContactWhereInput[] = [
    ...(e164 ? [{ phoneE164: e164 }] : []),
    ...(hasName
      ? [{ firstName: { equals: q.firstName, mode: "insensitive" as const }, lastName: { equals: q.lastName, mode: "insensitive" as const } }]
      : []),
    ...(email ? [{ email: { equals: email, mode: "insensitive" as const } }] : []),
  ];
  if (or.length === 0) return [];
  const rows = await db.contact.findMany({
    where: { AND: [{ deletedAt: null }, scope, { OR: or }, ...(q.excludeId ? [{ id: { not: q.excludeId } }] : [])] },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, phoneE164: true, type: true },
    orderBy: { createdAt: "asc" },
    take: 10,
  });
  return rows.map(({ phoneE164, ...c }) => {
    const reasons: string[] = [];
    if (e164 && phoneE164 === e164) reasons.push("Same phone number");
    if (hasName && c.firstName.toLowerCase() === q.firstName!.toLowerCase() && c.lastName.toLowerCase() === q.lastName!.toLowerCase()) reasons.push("Same name");
    if (email && c.email?.toLowerCase() === email.toLowerCase()) reasons.push("Same email");
    return { ...c, reasons };
  });
}
