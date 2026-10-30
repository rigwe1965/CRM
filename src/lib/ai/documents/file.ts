import { ApiError } from "@/lib/api";

/**
 * Checks an uploaded document on the server (the browser checks too, but only this check counts): its real type from the
 * first bytes rather than from its name or what the sender says it is, its size, and roughly how many pages a PDF has.
 * Nothing opens the file except the one model call.
 */
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
export const MAX_PDF_PAGES = 10;

export type DocumentFile = {
  mediaType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  bytes: Uint8Array;
};

const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

export function checkDocumentFile(bytes: Uint8Array): DocumentFile {
  if (bytes.length === 0) throw new ApiError(422, "That file is empty.", "DOCUMENT_INVALID");
  if (bytes.length > MAX_DOCUMENT_BYTES) throw new ApiError(413, `That file is larger than ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB. Use a smaller photo, or a PDF of the invoice pages only.`, "DOCUMENT_TOO_LARGE");

  if (starts(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    // Pages are counted from the page objects; a PDF that hides them in compressed streams is let through and the model's own limit applies.
    const text = Buffer.from(bytes).toString("latin1");
    const pages = (text.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
    if (pages > MAX_PDF_PAGES) throw new ApiError(422, `That PDF has ${pages} pages. Send ${MAX_PDF_PAGES} pages or fewer (the invoice pages only).`, "DOCUMENT_TOO_LONG");
    return { mediaType: "application/pdf", bytes };
  }
  if (starts(bytes, [0xff, 0xd8, 0xff])) return { mediaType: "image/jpeg", bytes };
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mediaType: "image/png", bytes };
  if (starts(bytes, [0x52, 0x49, 0x46, 0x46]) && starts(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return { mediaType: "image/webp", bytes };
  throw new ApiError(415, "Only PDF, JPG, PNG or WEBP files can be read.", "DOCUMENT_TYPE");
}
