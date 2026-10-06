import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { ownerScope } from "@/lib/access";
import type { SessionUser } from "@/lib/auth-helpers";

/** Prisma Decimal → JSON number (Decimal(14,2) is well inside double precision). */
const num = (d: Prisma.Decimal) => Number(d);

export const invoiceInclude = {
  owner: { select: { id: true, name: true } },
  deals: { where: { deletedAt: null }, select: { id: true, title: true }, orderBy: { title: "asc" } },
} satisfies Prisma.InvoiceInclude;

export const invoiceWithItems = {
  ...invoiceInclude,
  items: { orderBy: { position: "asc" } },
} satisfies Prisma.InvoiceInclude;

type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;
type ItemRow = Prisma.InvoiceItemGetPayload<object>;

export function invoiceDto<T extends InvoiceRow & { items?: ItemRow[] }>(invoice: T) {
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

const round2 = (n: number) => Math.round(n * 100) / 100;

type ItemInput = { quantity: number; unitPrice: number; lineTotal?: number };

/** Fills in per-line totals and the sheet subtotal. The deal price defaults to subtotal + shipping. */
export function invoiceTotals(items: ItemInput[], shipping = 0, total?: number) {
  const lineTotals = items.map((i) => i.lineTotal ?? round2(i.quantity * i.unitPrice));
  const subtotal = round2(lineTotals.reduce((s, n) => s + n, 0));
  return { lineTotals, subtotal, total: total ?? round2(subtotal + shipping) };
}

/** Deals a caller may link: their own live deals (admins: any live deal). */
export async function assertDealIds(user: SessionUser, dealIds: string[]) {
  const unique = [...new Set(dealIds)];
  if (unique.length === 0) return unique;
  const found = await db.deal.count({ where: { id: { in: unique }, deletedAt: null, ...ownerScope(user) } });
  if (found !== unique.length) {
    throw new ApiError(422, "A linked deal was not found", "INVALID_REFERENCE", { dealIds: ["Deal not found"] });
  }
  return unique;
}
