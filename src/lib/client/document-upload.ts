// Gets a PDF or photo ready for Ivy to read, and sends it. Runs in the browser. The server checks the file again, so these
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

export async function readInvoiceDocument(file: File): Promise<DocumentReading> {
  if (!TYPES.includes(file.type)) throw new ApiClientError(422, "Only PDF, JPG, PNG or WEBP files can be read.", "DOCUMENT_TYPE");
  const blob = file.type === "application/pdf" ? file : await shrink(file);
  if (blob.size > MAX_DOCUMENT_BYTES) throw new ApiClientError(413, "That file is larger than 4 MB. Use a smaller photo, or a PDF of the invoice pages only.", "DOCUMENT_TOO_LARGE");

  const form = new FormData();
  form.set("kind", "invoice");
  form.set("file", blob, file.type === "application/pdf" ? "invoice.pdf" : "invoice.jpg");
  let res: Response;
  try {
    res = await fetch("/api/assistant/documents", { method: "POST", body: form });
  } catch {
    throw new ApiClientError(0, "Network error. Check your connection and try again.", "NETWORK");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiClientError(res.status, json.error ?? "Something went wrong. Please try again.", json.code ?? "ERROR", json.fieldErrors ?? {});
  return json.data as DocumentReading;
}
