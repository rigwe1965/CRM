import { ApiError, ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { checkDocumentFile, MAX_DOCUMENT_BYTES } from "@/lib/ai/documents/file";
import { assertCanReadDocument, readInvoiceFile } from "@/lib/ai/documents/invoice";
import { assertCanReadOrder, readOrderFile } from "@/lib/ai/documents/order";
import { assertCanReadPayment, readPaymentFile } from "@/lib/ai/documents/payment";

export const dynamic = "force-dynamic";
// The person waits for the answer (a spinner, then the form), inside the host's function limit.
export const maxDuration = 60;

/**
 * POST /api/assistant/documents (multipart: file, kind=invoice|order|payment): reads a supplier invoice from a PDF or photo and
 * returns the fields for the New invoice form, with warnings; or (kind=order, with an optional conversationId) reads a
 * customer's order screenshot into a Create a deal card for the person to approve. Reading saves nothing and keeps
 * nothing; or (kind=payment) a bank transfer receipt into a Record a payment card, the strictest of the three. The file is held in memory for this request. The gates (Ivy on, "Read documents" on, key, ceiling, daily
 * number, rate limit; for an order also proposed actions) run before the file is read.
 */
export const POST = authed(async ({ req, user }) => {
  // The size must be declared: a request with no length (chunked) is refused, so the body is never read without a bound.
  const header = req.headers.get("content-length");
  const declared = header === null ? NaN : Number(header);
  if (!Number.isFinite(declared) || declared <= 0) throw new ApiError(411, "Send the file with its size.", "LENGTH_REQUIRED");
  // Leave room for the form's own framing; the exact size is checked again on the bytes.
  if (declared > MAX_DOCUMENT_BYTES + 64 * 1024) throw new ApiError(413, "That file is too large. Use a smaller photo, or a PDF of the invoice pages only.", "DOCUMENT_TOO_LARGE");
  const form = await req.formData().catch(() => null);
  const kind = form?.get("kind");
  const file = form?.get("file");
  if (!(file instanceof File) || (kind !== "invoice" && kind !== "order" && kind !== "payment")) throw new ApiError(422, "Send a file and say whether it is an invoice, an order or a payment receipt.", "VALIDATION_ERROR");
  if (kind === "order") await assertCanReadOrder(user);
  else if (kind === "payment") await assertCanReadPayment(user);
  else await assertCanReadDocument(user);
  const checked = checkDocumentFile(new Uint8Array(await file.arrayBuffer()));
  if (kind === "order" || kind === "payment") {
    const raw = form?.get("conversationId");
    const opts = { gated: true, conversationId: typeof raw === "string" && raw ? raw.slice(0, 40) : undefined };
    return ok(kind === "order" ? await readOrderFile(user, checked, opts) : await readPaymentFile(user, checked, opts));
  }
  return ok(await readInvoiceFile(user, checked, { gated: true }));
});
