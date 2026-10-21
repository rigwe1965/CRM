import { db } from "@/lib/db";
import { ApiError, readQuery } from "@/lib/api";
import { authed } from "@/lib/route";
import { notFound, ownerScope } from "@/lib/access";
import { dealPaymentsView } from "@/lib/payments";
import { dealStatementPdf, invoicePdf } from "@/lib/export/pdf";
import { enforceExportLimit, MAX_PDF_LINES, recordExport } from "@/lib/export/limits";
import { exportDocumentQuery, idParam } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

const num = (d: { toString(): string }) => Number(d);
/** Letters, digits, dot, dash and underscore only: the name in the download header is never raw user text. */
const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 40) || "document";

function pdfResponse(bytes: Uint8Array, name: string) {
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}.pdf"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * GET /api/export/deals/:id (a deal statement) and /api/export/invoices/:id (a supplier invoice) as a PDF.
 * Same rules as the CSV exports: the caller must be able to see the record, the export is rate limited
 * and audited before anything is sent, and a document over 2,000 lines is refused.
 */
export const GET = authed<{ entity: string; id: string }>(async ({ req, user, params }) => {
  if (params.entity !== "deals" && params.entity !== "invoices") throw notFound("Export");
  const { id } = idParam.parse({ id: params.id });
  const { lines: pickedLines } = readQuery(req, exportDocumentQuery);
  if (pickedLines && params.entity !== "invoices") throw new ApiError(422, "Choosing lines is only available for invoices", "VALIDATION_ERROR");
  await enforceExportLimit(user);
  const generatedAt = new Date();
  const date = generatedAt.toISOString().slice(0, 10);

  if (params.entity === "deals") {
    const deal = await db.deal.findFirst({
      where: { id, deletedAt: null, ...ownerScope(user) },
      select: {
        id: true, title: true, stage: true, amount: true, currency: true,
        organization: { select: { name: true } },
        contact: { select: { firstName: true, lastName: true } },
        owner: { select: { name: true } },
        items: {
          orderBy: { position: "asc" },
          select: { productType: true, texture: true, lengthInches: true, color: true, laceType: true, quantity: true, unitPrice: true },
        },
      },
    });
    if (!deal) throw notFound("Deal");
    const view = await dealPaymentsView(deal);
    const lines = deal.items.length + view.payments.length + view.instalments.length;
    if (lines > MAX_PDF_LINES) {
      throw new ApiError(422, `This statement has ${lines} lines; the limit is ${MAX_PDF_LINES}. Export the CSV instead.`, "EXPORT_TOO_LARGE");
    }
    await recordExport(req, user, {
      entity: "deals", format: "pdf", rows: 1, filters: { id }, summary: `Exported deal statement ${deal.title} as PDF`,
    });
    const bytes = await dealStatementPdf({
      generatedAt,
      deal: {
        title: deal.title, stage: deal.stage, currency: deal.currency, amount: num(deal.amount),
        customer: deal.contact ? `${deal.contact.firstName} ${deal.contact.lastName}` : "",
        organization: deal.organization?.name ?? "", owner: deal.owner.name,
      },
      items: deal.items.map((i) => ({ ...i, unitPrice: num(i.unitPrice) })),
      payments: view.payments.map((p) => ({ paidAt: p.paidAt, method: p.method, reference: p.reference, amount: p.amount })),
      instalments: view.instalments.map((i) => ({ position: i.position, dueDate: i.dueDate, amount: i.amount, covered: i.covered, overdue: i.overdue })),
      paid: view.summary.paid,
      balance: view.summary.balance,
    });
    return pdfResponse(bytes, `deal-statement-${safeName(deal.title)}-${date}`);
  }

  const invoice = await db.invoice.findFirst({
    where: { id, ...ownerScope(user) },
    select: {
      id: true, number: true, status: true, invoiceDate: true, currency: true, vendorName: true, vendorRep: true,
      vendorPhone: true, billTo: true, subtotal: true, shipping: true, total: true, notes: true,
      // The internal resale/margin figure is deliberately not selected: this document gets shared.
      items: {
        orderBy: { position: "asc" },
        select: { id: true, ref: true, style: true, description: true, color: true, density: true, lengthInches: true, quantity: true, unitPrice: true, lineTotal: true },
      },
    },
  });
  if (!invoice) throw notFound("Invoice");
  // Only lines of THIS invoice can be picked: ids from anywhere else are simply not in the list.
  const chosen = pickedLines ? new Set(pickedLines) : null;
  const shown = chosen ? invoice.items.filter((i) => chosen.has(i.id)) : invoice.items;
  if (chosen && shown.length === 0) {
    throw new ApiError(422, "None of the chosen lines belong to this invoice", "VALIDATION_ERROR");
  }
  if (shown.length > MAX_PDF_LINES) {
    throw new ApiError(422, `This invoice has ${shown.length} lines; the limit is ${MAX_PDF_LINES}. Export the CSV instead.`, "EXPORT_TOO_LARGE");
  }
  const partial = chosen && shown.length < invoice.items.length ? { shown: shown.length, of: invoice.items.length } : null;
  await recordExport(req, user, {
    entity: "invoices", format: "pdf", rows: 1, filters: partial ? { id, lines: shown.length } : { id },
    summary: partial
      ? `Exported ${partial.shown} of ${partial.of} lines of invoice ${invoice.number} as PDF`
      : `Exported invoice ${invoice.number} as PDF`,
  });
  const bytes = await invoicePdf({
    generatedAt,
    invoice: {
      number: invoice.number, status: invoice.status, invoiceDate: invoice.invoiceDate, currency: invoice.currency,
      vendorName: invoice.vendorName, vendorRep: invoice.vendorRep, vendorPhone: invoice.vendorPhone, billTo: invoice.billTo,
      subtotal: num(invoice.subtotal), shipping: num(invoice.shipping), total: num(invoice.total), notes: invoice.notes,
    },
    items: shown.map((i) => ({
      ref: i.ref, style: i.style, description: i.description, color: i.color, density: i.density,
      lengthInches: i.lengthInches, quantity: i.quantity, unitPrice: num(i.unitPrice), lineTotal: num(i.lineTotal),
    })),
    partial,
  });
  return pdfResponse(bytes, `invoice-${safeName(invoice.number)}${partial ? "-selected-lines" : ""}-${date}`);
});
