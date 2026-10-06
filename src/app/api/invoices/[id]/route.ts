import { db } from "@/lib/db";
import { noContent, ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { notFound, ownerScope } from "@/lib/access";
import { assertDealIds, invoiceDto, invoiceTotals, invoiceWithItems } from "@/lib/invoices";
import { updateInvoiceSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

type P = { id: string };

/** GET /api/invoices/:id: invoice with its line items in sheet order and linked deals. */
export const GET = authed<P>(async ({ user, params }) => {
  const invoice = await db.invoice.findFirst({
    where: { id: params.id, ...ownerScope(user) },
    include: invoiceWithItems,
  });
  if (!invoice) throw notFound("Invoice");
  return ok(invoiceDto(invoice));
});

/**
 * PATCH /api/invoices/:id: partial update. Sending `items` replaces all lines and recomputes the
 * sheet subtotal (and the deal price, unless `total` is sent); sending `dealIds` replaces the links.
 */
export const PATCH = authed<P>(async ({ req, user, params }) => {
  const { items, dealIds, ...body } = await readBody(req, updateInvoiceSchema);
  const existing = await db.invoice.findFirst({ where: { id: params.id, ...ownerScope(user) } });
  if (!existing) throw notFound("Invoice");
  const links = dealIds === undefined ? undefined : await assertDealIds(user, dealIds);

  const invoice = await db.$transaction(async (tx) => {
    let money = {};
    if (items) {
      const t = invoiceTotals(items, body.shipping ?? Number(existing.shipping), body.total);
      money = { subtotal: t.subtotal, total: t.total };
      await tx.invoiceItem.deleteMany({ where: { invoiceId: params.id } });
      await tx.invoiceItem.createMany({
        data: items.map((i, n) => ({ ...i, invoiceId: params.id, position: n + 1, lineTotal: t.lineTotals[n] })),
      });
    }
    return tx.invoice.update({
      where: { id: params.id },
      data: { ...body, ...money, ...(links && { deals: { set: links.map((id) => ({ id })) } }) },
      include: invoiceWithItems,
    });
  });
  return ok(invoiceDto(invoice));
});

/** DELETE /api/invoices/:id: permanent delete (its lines go with it). */
export const DELETE = authed<P>(async ({ user, params }) => {
  const { count } = await db.invoice.deleteMany({ where: { id: params.id, ...ownerScope(user) } });
  if (count === 0) throw notFound("Invoice");
  return noContent();
});
