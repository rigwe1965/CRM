import { describe, expect, it } from "vitest";
import { checkDocumentFile, MAX_DOCUMENT_BYTES, MAX_PDF_PAGES } from "@/lib/ai/documents/file";

const bytes = (...b: number[]) => Uint8Array.from(b);
const pdf = (pages: number) => new TextEncoder().encode(`%PDF-1.4\n${Array.from({ length: pages }, (_, i) => `${i} 0 obj << /Type /Page /Parent 1 0 R >> endobj\n`).join("")}<< /Type /Pages /Count ${pages} >>`);

describe("checkDocumentFile", () => {
  it("knows the real type from the first bytes, not from a name or a claimed type", () => {
    expect(checkDocumentFile(pdf(1)).mediaType).toBe("application/pdf");
    expect(checkDocumentFile(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0)).mediaType).toBe("image/jpeg");
    expect(checkDocumentFile(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)).mediaType).toBe("image/png");
    expect(checkDocumentFile(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50)).mediaType).toBe("image/webp");
  });

  it("refuses anything else: a script, a zip, a Word file, an SVG, plain text", () => {
    for (const text of ["<script>alert(1)</script>", "<svg xmlns='http://www.w3.org/2000/svg'/>", "hello world"]) {
      expect(() => checkDocumentFile(new TextEncoder().encode(text))).toThrow(/Only PDF, JPG, PNG or WEBP/);
    }
    expect(() => checkDocumentFile(bytes(0x50, 0x4b, 0x03, 0x04, 0))).toThrow(/Only PDF/); // zip, docx, xlsx
    expect(() => checkDocumentFile(bytes(0x4d, 0x5a, 0x90, 0))).toThrow(/Only PDF/); // an executable
  });

  it("refuses an empty file and one over 4 MB, with status codes the browser can show", () => {
    expect(() => checkDocumentFile(new Uint8Array(0))).toThrow(/empty/);
    const big = new Uint8Array(MAX_DOCUMENT_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    expect(() => checkDocumentFile(big)).toThrow(/larger than 4 MB/);
    try {
      checkDocumentFile(big);
    } catch (e) {
      expect((e as { status: number }).status).toBe(413);
    }
  });

  it(`refuses a PDF of more than ${MAX_PDF_PAGES} pages, and lets ${MAX_PDF_PAGES} through`, () => {
    expect(checkDocumentFile(pdf(MAX_PDF_PAGES)).mediaType).toBe("application/pdf");
    expect(() => checkDocumentFile(pdf(MAX_PDF_PAGES + 1))).toThrow(/11 pages/);
  });
});
