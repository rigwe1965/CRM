import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import type { SessionUser } from "@/lib/auth-helpers";
import { tenantScope } from "@/lib/access";
import { anthropicFor } from "@/lib/ai/client";
import { tokenUsage } from "@/lib/ai/pricing";
import { modelFields } from "@/lib/ai/models";
import { DEFAULT_DOCUMENTS_DAILY_CAP, effectiveModel, loadAssistantSettings } from "@/lib/ai/settings";
import { assertCanAsk } from "@/lib/ai/status";
import { recordUsage } from "@/lib/ai/usage";
import { reserveDocument } from "@/lib/ai/documents/reserve";
import type { DocumentFile } from "@/lib/ai/documents/file";
import { INVOICE_PROMPT, INVOICE_TOOL, MAX_DOCUMENT_LINES, readInvoiceInput, type ReadInvoice } from "@/lib/ai/documents/prompt";

/**
 * Reading a supplier invoice from a PDF or photo (AI_ASSISTANT_PLAN.md, Phase 4a). The model copies what is printed;
 * this file does everything that must not be left to it: the gates (AI on, "Read documents" on, key, ceiling, daily
 * number), recomputing every line total, comparing the lines with the printed total, flagging a duplicate invoice number,
 * and shaping the result for the New invoice form. Nothing is saved and the file is not kept: the person reads the form
 * and saves it through the ordinary invoice route.
 */

export type InvoiceHeader = {
  number: string;
  invoiceDate: string;
  currency: string;
  vendorName: string;
  vendorRep: string;
  vendorPhone: string;
  billTo: string;
  shipping: string;
  notes: string;
};
export type ReadItem = {
  ref: string;
  style: string;
  description: string;
  color: string;
  density: string;
  lengthInches: number | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number | null;
  resalePrice: number | null;
  note: string;
};
export type InvoiceReading = { header: InvoiceHeader; items: ReadItem[]; warnings: string[] };

const cents = (n: number) => Math.round(n * 100);
const money = (n: number) => n.toFixed(2);
/** Printed figures may differ from our arithmetic by rounding only: 5 cents, plus a cent for each line summed. */
const close = (a: number, b: number, lines = 1) => Math.abs(a - b) <= 0.05 + 0.01 * lines;

/** Turns what the model copied into the form's shape, with the checks the server (not the model) owns. Pure. */
export function buildReading(r: ReadInvoice, ctx: { duplicateNumber: boolean; today?: Date }): InvoiceReading {
  const warnings: string[] = [];
  const today = ctx.today ?? new Date();

  const items: ReadItem[] = r.items.slice(0, MAX_DOCUMENT_LINES).map((i, n) => {
    const style = i.style ?? i.description ?? "";
    const description = i.description ?? i.style ?? "";
    const computed = Math.round(i.quantity * i.unitPrice * 100) / 100;
    if (i.printedLineTotal !== undefined && !close(i.printedLineTotal, computed)) {
      warnings.push(`Line ${n + 1}: the invoice prints ${money(i.printedLineTotal)} but ${i.quantity} × ${money(i.unitPrice)} is ${money(computed)}. Check the quantity and price.`);
    }
    if (i.unitPrice === 0) warnings.push(`Line ${n + 1} has a price of 0. Check it.`);
    return {
      ref: i.ref || String(n + 1),
      style,
      description,
      color: i.color ?? "",
      density: i.density ?? "",
      lengthInches: i.lengthInches ?? null,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      lineTotal: null, // always computed from quantity x price, never copied from the page
      resalePrice: null,
      note: i.note ?? "",
    };
  });
  if (r.items.length > MAX_DOCUMENT_LINES) warnings.push(`The invoice has more than ${MAX_DOCUMENT_LINES} lines; only the first ${MAX_DOCUMENT_LINES} were read.`);

  const subtotal = items.reduce((s, i) => s + cents(i.quantity * i.unitPrice), 0) / 100;
  const shipping = r.shipping ?? 0;
  if (r.printedTotal !== undefined && !close(subtotal + shipping, r.printedTotal, items.length)) {
    warnings.push(
      `The lines add up to ${money(subtotal)}${shipping ? ` plus ${money(shipping)} shipping (${money(subtotal + shipping)})` : ""}, but the invoice prints a total of ${money(r.printedTotal)}. Something was misread or a line is missing: check every line against the invoice.`,
    );
  }

  const currency = r.currency && /^[A-Za-z]{3}$/.test(r.currency) ? r.currency.toUpperCase() : "USD";
  if (!r.currency || !/^[A-Za-z]{3}$/.test(r.currency)) warnings.push("No currency could be read, so USD is filled in. Check it.");

  const missing = [
    !r.number && "the invoice number",
    !r.invoiceDate && "the date",
    !r.vendorName && "the supplier",
    !r.billTo && "who it is addressed to",
  ].filter(Boolean);
  if (missing.length) warnings.push(`Not found on the document: ${missing.join(", ")}. Fill ${missing.length === 1 ? "it" : "them"} in.`);

  if (r.invoiceDate) {
    const d = new Date(`${r.invoiceDate}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 2000 || d.getTime() > today.getTime() + 366 * 86_400_000) warnings.push(`The date ${r.invoiceDate} looks wrong. Check it.`);
  }
  if (ctx.duplicateNumber && r.number) warnings.push(`You already have an invoice numbered ${r.number}. Invoice numbers must be different, so change this one or check you are not entering it twice.`);
  if (items.length === 0) warnings.push("No product lines could be read. Add them by hand, or try a clearer photo.");

  return {
    header: {
      number: r.number ?? "",
      invoiceDate: r.invoiceDate ?? "",
      currency,
      vendorName: r.vendorName ?? "",
      vendorRep: r.vendorRep ?? "",
      vendorPhone: r.vendorPhone ?? "",
      billTo: r.billTo ?? "",
      shipping: r.shipping !== undefined ? String(r.shipping) : "",
      notes: r.notes ?? "",
    },
    items,
    warnings,
  };
}

/** The documents a business has had read since midnight UTC (one usage record each). */
async function readToday(tenantId: string, now: Date) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return db.aiUsage.count({ where: { tenantId, purpose: "DOCUMENT", createdAt: { gte: start } } });
}

/** Everything that decides whether this person may have a document read right now. Throws a plain-words ApiError. */
export async function assertCanReadDocument(user: Pick<SessionUser, "id" | "tenantId">, now = new Date()) {
  await assertCanAsk(user, now); // AI on, key, ceiling, and the same rate limit as a question
  const settings = await loadAssistantSettings(user.tenantId);
  if (settings.documentsEnabled !== true) throw new ApiError(403, "Reading documents is switched off for this business. An admin can allow it in Settings, under AI assistant. You can still import a spreadsheet or type the invoice in.", "AI_DOCUMENTS_OFF");
  const cap = settings.documentsDailyCap ?? DEFAULT_DOCUMENTS_DAILY_CAP;
  if ((await readToday(user.tenantId, now)) >= cap) throw new ApiError(429, `Today's limit of ${cap} documents has been reached. Try again tomorrow, or type the invoice in.`, "AI_DOCUMENTS_CAP");
}

/** The one request that reads an invoice. Exported so the quality check (scripts/document-eval.ts) sends exactly what the app sends. */
export function invoiceRequest(file: DocumentFile, model?: string) {
  const data = Buffer.from(file.bytes).toString("base64");
  const source =
    file.mediaType === "application/pdf"
      ? ({ type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data } })
      : ({ type: "image" as const, source: { type: "base64" as const, media_type: file.mediaType, data } });
  return {
    ...modelFields(model),
    max_tokens: 16000,
    system: INVOICE_PROMPT,
    tools: [INVOICE_TOOL] as unknown as Anthropic.Beta.BetaToolUnion[],
    messages: [{ role: "user" as const, content: [source, { type: "text" as const, text: "Read this supplier invoice." }] }],
  };
}

/** Reads one invoice file. The call is recorded (and costed) whether or not it gave a usable answer. */
export async function readInvoiceFile(user: SessionUser, file: DocumentFile, opts: { now?: Date; client?: Pick<Anthropic, "beta">; /** The caller has already run the gates (the route does, before reading the upload). */ gated?: boolean } = {}): Promise<InvoiceReading> {
  const now = opts.now ?? new Date();
  if (!opts.gated) await assertCanReadDocument(user, now);
  const client = opts.client ?? (await anthropicFor(user.tenantId));

  const release = await reserveDocument(user, now);
  const model = await effectiveModel(user.tenantId, user.id);
  let message;
  try {
    message = await client.beta.messages.create(invoiceRequest(file, model), { timeout: 55_000 });
  } catch (e) {
    console.error("[ivy-documents] read failed", e instanceof Error ? e.message : e);
    await release();
    throw new ApiError(502, "AI could not read that document just now. Try again in a moment, or import a spreadsheet or type the invoice in.", "AI_DOCUMENT_FAILED");
  }
  try {
    await recordUsage({ tenantId: user.tenantId, userId: user.id, model: message.model, usage: tokenUsage(message.usage), purpose: "DOCUMENT" });
  } finally {
    await release();
  }

  const use = message.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === INVOICE_TOOL.name);
  const parsed = use ? readInvoiceInput.safeParse(use.input) : null;
  if (message.stop_reason === "max_tokens") {
    throw new ApiError(422, "That invoice is too long for AI to read in one go. Send it a few pages at a time, import a spreadsheet, or type it in.", "AI_DOCUMENT_TOO_LONG");
  }
  if (!parsed?.success) {
    throw new ApiError(422, "AI could not make sense of that document. Try a clearer photo or a PDF, or type the invoice in.", "AI_DOCUMENT_UNREADABLE");
  }
  if (!parsed.data.readable) {
    // The model's reason is shown as text, clipped; it came from a stranger's document, so it is data, not an instruction.
    throw new ApiError(422, `That does not look like a supplier invoice AI can read${parsed.data.problem ? ` (${parsed.data.problem.slice(0, 200)})` : ""}. Try a clearer photo or a PDF.`, "AI_DOCUMENT_UNREADABLE");
  }

  const duplicate = parsed.data.number ? !!(await db.invoice.findFirst({ where: { ...tenantScope(user), number: parsed.data.number }, select: { id: true } })) : false;
  return buildReading(parsed.data, { duplicateNumber: duplicate, today: now });
}
