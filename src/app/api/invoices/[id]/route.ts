import { db } from "@/lib/db";
import { ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { notFound, ownerScope } from "@/lib/access";
import { invoiceDto } from "@/lib/invoices";

export const dynamic = "force-dynamic";

/** GET /api/invoices/:id: invoice with its line items in sheet order. */
export const GET = authed<{ id: string }>(async ({ user, params }) => {
  const invoice = await db.invoice.findFirst({
    where: { id: params.id, ...ownerScope(user) },
    include: { owner: { select: { id: true, name: true } }, items: { orderBy: { position: "asc" } } },
  });
  if (!invoice) throw notFound("Invoice");
  return ok(invoiceDto(invoice));
});
