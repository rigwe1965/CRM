import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { paginated, readQuery } from "@/lib/api";
import { authed } from "@/lib/route";
import { ownerScope } from "@/lib/access";
import { invoiceDto } from "@/lib/invoices";
import { invoiceListQuery } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

/** GET /api/invoices: list (search q on number/billTo/vendorName; sort number|invoiceDate|total|createdAt). */
export const GET = authed(async ({ req, user }) => {
  const q = readQuery(req, invoiceListQuery);
  const where: Prisma.InvoiceWhereInput = {
    ...ownerScope(user),
    ...(q.q && {
      OR: [
        { number: { contains: q.q, mode: "insensitive" } },
        { billTo: { contains: q.q, mode: "insensitive" } },
        { vendorName: { contains: q.q, mode: "insensitive" } },
      ],
    }),
  };
  const [total, items] = await db.$transaction([
    db.invoice.count({ where }),
    db.invoice.findMany({
      where,
      include: { owner: { select: { id: true, name: true } }, _count: { select: { items: true } } },
      orderBy: [{ [q.sort]: q.order }, { id: "asc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return paginated(items.map(invoiceDto), total, q.page, q.pageSize);
});
