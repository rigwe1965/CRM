import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, paginated, readBody, readQuery } from "@/lib/api";
import { authed } from "@/lib/route";
import { ownerScope } from "@/lib/access";
import { assertDealIds, invoiceDto, invoiceInclude, invoiceTotals, invoiceWithItems } from "@/lib/invoices";
import { createInvoiceSchema, invoiceListQuery } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

/** GET /api/invoices: list (search q on number/billTo/vendorName; filter status; sort number|invoiceDate|total|createdAt). */
export const GET = authed(async ({ req, user }) => {
  const q = readQuery(req, invoiceListQuery);
  const where: Prisma.InvoiceWhereInput = {
    ...ownerScope(user),
    ...(q.status && { status: q.status }),
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
      include: { ...invoiceInclude, _count: { select: { items: true } } },
      orderBy: [{ [q.sort]: q.order }, { id: "asc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return paginated(items.map(invoiceDto), total, q.page, q.pageSize);
});

/** POST /api/invoices: create with its line items. Owner is the caller. */
export const POST = authed(async ({ req, user }) => {
  const { items, dealIds, ...body } = await readBody(req, createInvoiceSchema);
  const links = await assertDealIds(user, dealIds ?? []);
  const t = invoiceTotals(items, body.shipping, body.total);
  const invoice = await db.invoice.create({
    data: {
      ...body,
      subtotal: t.subtotal,
      total: t.total,
      ownerId: user.id,
      items: { create: items.map((i, n) => ({ ...i, position: n + 1, lineTotal: t.lineTotals[n] })) },
      deals: { connect: links.map((id) => ({ id })) },
    },
    include: invoiceWithItems,
  });
  return ok(invoiceDto(invoice), 201);
});
