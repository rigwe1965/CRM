import type { Prisma } from "@prisma/client";

/** Prisma Decimal → JSON number (Decimal(14,2) is well inside double precision). */
const num = (d: Prisma.Decimal) => Number(d);

type InvoiceRow = Prisma.InvoiceGetPayload<{ include: { owner: { select: { id: true; name: true } }; items: true } }>;

export function invoiceDto<T extends Omit<InvoiceRow, "items"> & { items?: InvoiceRow["items"] }>(invoice: T) {
  return {
    ...invoice,
    subtotal: num(invoice.subtotal),
    shipping: num(invoice.shipping),
    total: num(invoice.total),
    items: invoice.items?.map((i) => ({
      ...i,
      unitPrice: num(i.unitPrice),
      lineTotal: num(i.lineTotal),
      resalePrice: i.resalePrice === null ? null : num(i.resalePrice),
    })),
  };
}
