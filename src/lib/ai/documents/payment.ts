import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import type { SessionUser } from "@/lib/auth-helpers";
import { ownerScope } from "@/lib/access";
import { anthropicFor } from "@/lib/ai/client";
import { tokenUsage } from "@/lib/ai/pricing";
import { modelFields } from "@/lib/ai/models";
import { appendMessages } from "@/lib/ai/conversations";
import { propose } from "@/lib/ai/proposals";
import { effectiveModel, loadAssistantSettings } from "@/lib/ai/settings";
import { recordUsage } from "@/lib/ai/usage";
import { reserveDocument } from "@/lib/ai/documents/reserve";
import { ToolError } from "@/lib/ai/tools/types";
import { paymentSummaries } from "@/lib/payments";
import type { DocumentFile } from "@/lib/ai/documents/file";
import { assertCanReadDocument } from "@/lib/ai/documents/invoice";
import { chatFor, display, matchCustomer, type Found } from "@/lib/ai/documents/order";
import { PAYMENT_PROMPT, PAYMENT_TOOL, paymentDraft, readPaymentInput, type PaymentDraft, type ReadPayment } from "@/lib/ai/documents/payment-prompt";

/**
 * Reading a bank transfer receipt into a Record a payment card (AI_ASSISTANT_PLAN.md, Phase 4c). The strictest of the
 * readers. The model copies what the picture shows; this file decides everything that matters: a receipt not shown as
 * completed never becomes a card, the deal is found among the person's own open deals in the receipt's currency (never
 * guessed: more than one possible deal means the person chooses), the amount may not exceed the balance, and the card is
 * made through the same `propose` path, duplicate warning and confirm dialog as a typed payment. A screenshot is not
 * proof of payment and the card says so. Nothing is saved by reading; the picture is not kept; no text from it is put in
 * the saved chat.
 */

export type PaymentCandidate = { id: string; label: string };
export type PaymentResult = {
  conversationId: string;
  /** card: a Record a payment card is waiting. pick_deal: more than one deal could be meant, the person chooses. incomplete: no card can be made. */
  outcome: "card" | "pick_deal" | "incomplete";
  message: string;
  candidates: PaymentCandidate[];
  draft: PaymentDraft | null;
};

const money = (n: number) => n.toFixed(2);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const NOT_PROOF = "A screenshot is not proof of payment. Check your bank before recording this.";

/** Pure: turns what the model copied into a draft, or the reasons it cannot be one. Reasons never quote the picture. */
export function buildPayment(r: ReadPayment, today: Date): { draft: PaymentDraft | null; blocking: string[]; warnings: string[] } {
  const blocking: string[] = [];
  const warnings: string[] = [];
  if (r.severalPayments) blocking.push("The picture shows more than one payment. Crop it to the one payment and try again.");
  if (r.status === "PENDING") blocking.push("The receipt shows the transfer as still pending, so no money has arrived yet.");
  else if (r.status === "FAILED") blocking.push("The receipt shows the transfer as failed or reversed.");
  else if (r.status !== "COMPLETED") blocking.push("The receipt does not clearly say the transfer was completed.");
  if (!r.amount || r.amount <= 0) blocking.push("No amount is shown.");
  const currency = r.currency && /^[A-Za-z]{3}$/.test(r.currency) ? r.currency.toUpperCase() : null;
  if (!currency) blocking.push("The currency is not shown.");
  if (r.paidAt && r.paidAt > isoDay(today)) blocking.push(`The date on the receipt (${r.paidAt}) is in the future.`);
  if (blocking.length) return { draft: null, blocking, warnings };
  // "Today" or "7 minutes ago" is not a date in the picture: the date comes from the server's clock, never from the model.
  const paidAt = r.paidAt ?? (r.shownAsToday ? isoDay(today) : undefined);
  if (!r.paidAt && r.shownAsToday) warnings.push("The receipt says the money arrived today but shows no calendar date, so today's date is used. Change it if that is wrong.");
  else if (!r.paidAt) warnings.push("No date is shown on the receipt, so today's date is used. Change it if the money arrived earlier.");
  // A bank reference is letters, digits and a few separators. Anything else on the receipt is not carried into the record.
  const reference = r.reference && /^[A-Za-z0-9 \-_/.#]{1,60}$/.test(r.reference) ? r.reference : undefined;
  return { draft: { amount: r.amount as number, currency: currency as string, ...(paidAt ? { paidAt } : {}), ...(reference ? { reference } : {}) }, blocking, warnings };
}

type OpenDeal = { id: string; title: string; balance: number; customer: string };

/** The deals the money could belong to: the given customers' own deals in this currency that are not lost and still owe something. */
async function openDeals(user: SessionUser, contacts: Found[], currency: string): Promise<OpenDeal[]> {
  if (contacts.length === 0) return [];
  const deals = await db.deal.findMany({
    where: { deletedAt: null, ...ownerScope(user), contactId: { in: contacts.map((c) => c.id) }, currency, stage: { not: "CLOSED_LOST" } },
    select: { id: true, title: true, amount: true, contact: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const sums = await paymentSummaries(deals);
  return deals
    .map((d) => ({ id: d.id, title: d.title, balance: sums.get(d.id)?.balance ?? 0, customer: d.contact ? display(d.contact) : "No customer" }))
    .filter((d) => d.balance > 0);
}

/** Everything that decides whether this person may have a receipt read now: the document gates, and that payment cards can be made. */
export async function assertCanReadPayment(user: Pick<SessionUser, "id" | "tenantId"> & { tenantWritable?: boolean }, now = new Date()) {
  await assertCanReadDocument(user, now);
  const settings = await loadAssistantSettings(user.tenantId);
  if (settings.proposalsEnabled !== true || settings.paymentProposalsEnabled !== true) {
    throw new ApiError(403, "Turning a receipt into a payment needs AI's payment proposals, which are switched off for this business. An admin can allow them in Settings, under AI assistant. You can still record the payment yourself on the deal's page.", "AI_PAYMENTS_OFF");
  }
  if (user.tenantWritable === false) throw new ApiError(403, "This workspace is read-only until its subscription is renewed, so no payment can be recorded.", "TENANT_READ_ONLY");
}

/** The one request that reads a receipt. Exported so the quality check sends exactly what the app sends. */
export function paymentRequest(file: DocumentFile, model?: string) {
  const data = Buffer.from(file.bytes).toString("base64");
  const source =
    file.mediaType === "application/pdf"
      ? ({ type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data } })
      : ({ type: "image" as const, source: { type: "base64" as const, media_type: file.mediaType, data } });
  return {
    ...modelFields(model),
    max_tokens: 4000,
    system: PAYMENT_PROMPT,
    tools: [PAYMENT_TOOL] as unknown as Anthropic.Beta.BetaToolUnion[],
    messages: [{ role: "user" as const, content: [source, { type: "text" as const, text: "Read this payment receipt." }] }],
  };
}

/** Makes the Record a payment card for a checked draft and a chosen deal. Throws ApiError in words for the person. */
async function cardFor(user: SessionUser, conversationId: string, dealId: string, draft: PaymentDraft, notes: string[], now: Date) {
  const deal = await db.deal.findFirst({ where: { id: dealId, deletedAt: null, ...ownerScope(user) }, select: { contact: { select: { firstName: true, lastName: true } } } });
  if (!deal) throw new ApiError(404, "That deal was not found among your deals.", "NOT_FOUND");
  try {
    await propose(
      { user, conversationId, now },
      "PAYMENT_RECORD",
      { dealId, amount: draft.amount, currency: draft.currency, paidAt: draft.paidAt, method: "BANK_TRANSFER", reference: draft.reference },
      { warning: [NOT_PROOF, ...notes].join(" ") },
    );
  } catch (e) {
    // The checks speak to the model ("Tell the person ..."); the person is shown the fact without that sentence.
    if (e instanceof ToolError) throw new ApiError(422, e.message.replace(/\s*[^.]*\b[Tt]ell the person[^.]*\./g, "").trim() || "That payment cannot be recorded.", "AI_PROPOSAL_REFUSED");
    throw e;
  }
  return deal.contact ? display(deal.contact) : "this deal";
}

/** Reads one receipt. The call is recorded (and costed) whether or not it gave a usable answer. */
export async function readPaymentFile(user: SessionUser, file: DocumentFile, opts: { conversationId?: string; now?: Date; client?: Pick<Anthropic, "beta">; gated?: boolean } = {}): Promise<PaymentResult> {
  const now = opts.now ?? new Date();
  if (!opts.gated) await assertCanReadPayment(user, now);
  const chat = await chatFor(user, opts.conversationId); // before the paid call, so a stale chat costs nothing
  const client = opts.client ?? (await anthropicFor(user.tenantId));

  const release = await reserveDocument(user, now);
  const model = await effectiveModel(user.tenantId, user.id);
  let message;
  try {
    message = await client.beta.messages.create(paymentRequest(file, model), { timeout: 55_000 });
  } catch (e) {
    console.error("[ivy-documents] payment read failed", e instanceof Error ? e.message : e);
    await release();
    throw new ApiError(502, "AI could not read that picture just now. Try again in a moment, or record the payment yourself on the deal's page.", "AI_DOCUMENT_FAILED");
  }
  try {
    await recordUsage({ tenantId: user.tenantId, userId: user.id, model: message.model, usage: tokenUsage(message.usage), purpose: "DOCUMENT" });
  } finally {
    await release();
  }

  const use = message.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === PAYMENT_TOOL.name);
  const parsed = use ? readPaymentInput.safeParse(use.input) : null;
  if (message.stop_reason === "max_tokens" || !parsed?.success) throw new ApiError(422, "AI could not make sense of that picture. Try a clearer screenshot, or record the payment yourself on the deal's page.", "AI_DOCUMENT_UNREADABLE");
  if (!parsed.data.readable) {
    throw new ApiError(422, `That does not look like a payment receipt AI can read${parsed.data.problem ? ` (${parsed.data.problem.slice(0, 200)})` : ""}. Try a clearer screenshot.`, "AI_DOCUMENT_UNREADABLE");
  }

  const finish = async (outcome: PaymentResult["outcome"], text: string, candidates: PaymentCandidate[] = [], d: PaymentDraft | null = null): Promise<PaymentResult> => {
    // Only text the server wrote goes into the saved chat, never anything from the picture.
    await appendMessages(user.tenantId, chat.id, [
      { role: "USER", content: [{ type: "text", text: "I attached a screenshot of a payment receipt." }] },
      { role: "ASSISTANT", content: [{ type: "text", text }] },
    ]);
    return { conversationId: chat.id, outcome, message: text, candidates, draft: d };
  };

  const { draft, blocking, warnings } = buildPayment(parsed.data, now);
  if (!draft) return finish("incomplete", `I read the receipt but I will not prepare a payment from it. ${blocking.join(" ")} Record the payment yourself on the deal's page once the money has arrived.`);

  const { match, candidates: possible } = await matchCustomer(user, { name: parsed.data.senderName });
  const deals = await openDeals(user, match ? [match] : possible, draft.currency);
  const fitting = deals.filter((d) => d.balance + 0.005 >= draft.amount);
  if (deals.length === 0) {
    return finish("incomplete", `I read the receipt for ${money(draft.amount)} ${draft.currency}, but I could not find an open deal in ${draft.currency} for the person who paid. The sender is not always your customer, so record it yourself on the right deal, or ask me and name the deal.`);
  }
  if (fitting.length === 0) {
    return finish("incomplete", `I read the receipt for ${money(draft.amount)} ${draft.currency}, but it is more than what is still owed on the open deal${deals.length > 1 ? "s" : ""} I found (the largest balance is ${money(Math.max(...deals.map((d) => d.balance)))} ${draft.currency}), so I will not prepare it. Check the amount, or record it yourself.`);
  }

  const note = "The deal was found from the name of the sender on the receipt, and the person who paid is not always your customer: check it is the right deal.";
  if (match && deals.length === 1) {
    const who = await cardFor(user, chat.id, fitting[0].id, draft, [...warnings, note], now);
    return finish("card", `I read the receipt and prepared recording ${money(draft.amount)} ${draft.currency} for ${who}. A screenshot is not proof of payment: check your bank, then approve or decline the card below.`);
  }
  return finish(
    "pick_deal",
    `I read the receipt for ${money(draft.amount)} ${draft.currency}, but I cannot tell for certain which deal it is for. Choose the deal and I will prepare the payment.`,
    fitting.map((d) => ({ id: d.id, label: `${d.customer}: ${d.title} (owes ${money(d.balance)} ${draft.currency})` })),
    draft,
  );
}

/** The person chose the deal from the list: makes the card from the draft they were shown. The draft is checked again; it came back through the browser. */
export async function chooseDeal(user: SessionUser, input: { conversationId: string; dealId: string; draft: unknown; now?: Date }): Promise<PaymentResult> {
  const now = input.now ?? new Date();
  const checked = paymentDraft.safeParse(input.draft);
  if (!checked.success) throw new ApiError(422, "That receipt could not be used. Attach the picture again.", "VALIDATION_ERROR");
  const chat = await chatFor(user, input.conversationId);
  const who = await cardFor(user, chat.id, input.dealId, checked.data, ["You chose the deal from a list: check it is the right one."], now);
  const text = `I prepared recording ${money(checked.data.amount)} ${checked.data.currency} for ${who}. A screenshot is not proof of payment: check your bank, then approve or decline the card below.`;
  await appendMessages(user.tenantId, chat.id, [
    { role: "USER", content: [{ type: "text", text: `I chose the deal for ${who}.` }] },
    { role: "ASSISTANT", content: [{ type: "text", text }] },
  ]);
  return { conversationId: chat.id, outcome: "card", message: text, candidates: [], draft: null };
}
