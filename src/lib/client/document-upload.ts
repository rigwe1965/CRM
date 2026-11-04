// Gets a PDF or photo ready for AI to read, and sends it. Runs in the browser. The server checks the file again, so these
// checks are only to save the person a wait. Nothing is kept: the file is read once and the answer fills a form.
import { ApiClientError } from "@/lib/client/api";

export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const MAX_PHOTO_SIDE = 1600;
const TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export type DocumentReading = {
  header: { number: string; invoiceDate: string; currency: string; vendorName: string; vendorRep: string; vendorPhone: string; billTo: string; shipping: string; notes: string };
  items: { ref: string; style: string; description: string; color: string; density: string; lengthInches: number | null; quantity: number; unitPrice: number; lineTotal: number | null; resalePrice: number | null; note: string }[];
  warnings: string[];
};

/** Photos from a phone are several megabytes; shrinking them keeps the text readable and the upload small. */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file; // let the server decide
  const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= 1.5 * 1024 * 1024) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return (await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85))) ?? file;
}

export type OrderReading = {
  conversationId: string;
  /** card: a card is waiting. pick_customer / pick_deal: the person chooses from `candidates`. incomplete: no card can be made. */
  outcome: "card" | "pick_customer" | "pick_deal" | "incomplete";
  message: string;
  candidates: { id: string; label: string }[];
  /** With pick_customer: sent back, unchanged, with the chosen customer. */
  draft: unknown;
};

/** The heading over the list AI shows when it could not place a picture for certain. */
export const pickHeading = (of: "customer" | "deal") => (of === "deal" ? "Choose the deal" : "Choose the customer");

/** Checks the file and, for a photo, shrinks it. Throws what the server would, sooner. */
async function prepare(file: File, what: string): Promise<Blob> {
  if (!TYPES.includes(file.type)) throw new ApiClientError(422, "Only PDF, JPG, PNG or WEBP files can be read.", "DOCUMENT_TYPE");
  const blob = file.type === "application/pdf" ? file : await shrink(file);
  if (blob.size > MAX_DOCUMENT_BYTES) throw new ApiClientError(413, `That file is larger than 4 MB. Use a smaller photo, or a PDF of the ${what} only.`, "DOCUMENT_TOO_LARGE");
  return blob;
}

export const readInvoiceDocument = async (file: File) => (await send(await prepare(file, "invoice pages"), file, { kind: "invoice" })) as DocumentReading;

/** Sends a customer's order screenshot; the answer says whether a deal card is now waiting, the customer must be chosen, or something is missing. */
export const readOrderDocument = async (file: File, conversationId?: string) => (await send(await prepare(file, "order"), file, { kind: "order", ...(conversationId ? { conversationId } : {}) })) as OrderReading;

/** Sends a bank transfer receipt; the answer says whether a Record a payment card is waiting, the deal must be chosen, or no card can be made. */
export const readPaymentDocument = async (file: File, conversationId?: string) => (await send(await prepare(file, "receipt"), file, { kind: "payment", ...(conversationId ? { conversationId } : {}) })) as OrderReading;

/** Chooses the deal for a receipt AI read but could not place for certain; makes the payment card. */
export async function choosePaymentDeal(body: { conversationId: string; dealId: string; draft: unknown }): Promise<OrderReading> {
  return post("/api/assistant/documents/payment", body);
}

/** Chooses the customer for an order AI read but could not match for certain; makes the deal card. */
export async function chooseOrderCustomer(body: { conversationId: string; contactId: string; draft: unknown }): Promise<OrderReading> {
  return post("/api/assistant/documents/order", body);
}

async function post(url: string, body: unknown): Promise<OrderReading> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new ApiClientError(0, "Network error. Check your connection and try again.", "NETWORK");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiClientError(res.status, json.error ?? "Something went wrong. Please try again.", json.code ?? "ERROR", json.fieldErrors ?? {});
  return json.data as OrderReading;
}

async function send(blob: Blob, file: File, fields: Record<string, string>): Promise<unknown> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  form.set("file", blob, file.type === "application/pdf" ? "document.pdf" : "document.jpg");
  let res: Response;
  try {
    res = await fetch("/api/assistant/documents", { method: "POST", body: form });
  } catch {
    throw new ApiClientError(0, "Network error. Check your connection and try again.", "NETWORK");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiClientError(res.status, json.error ?? "Something went wrong. Please try again.", json.code ?? "ERROR", json.fieldErrors ?? {});
  return json.data;
}
