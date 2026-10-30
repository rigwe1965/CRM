import { beforeEach, describe, expect, it, vi } from "vitest";

const { gate, read, holder } = vi.hoisted(() => ({
  gate: vi.fn(),
  read: vi.fn(),
  holder: { user: { id: "u1", tenantId: "t1", role: "SALES", name: "Sam", tenantWritable: true } as Record<string, unknown> },
}));
vi.mock("@/lib/route", () => ({
  authed: (handler: (ctx: unknown) => Promise<Response>) => async (req: Request) => {
    try {
      return await handler({ req, user: holder.user, params: {} });
    } catch (e) {
      const { toErrorResponse } = await import("@/lib/api");
      return toErrorResponse(e);
    }
  },
}));
vi.mock("@/lib/ai/documents/invoice", () => ({ assertCanReadDocument: gate, readInvoiceFile: read }));

import { ApiError } from "@/lib/api";
import { POST } from "@/app/api/assistant/documents/route";
import { allowedWhenReadOnly } from "@/lib/plans";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const post = (fields: Record<string, string | Blob>, headers: Record<string, string> = {}) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === "string") form.set(k, v);
    else form.set(k, v, "invoice.pdf");
  }
  return (POST as unknown as (r: Request) => Promise<Response>)(new Request("http://x.test/api/assistant/documents", { method: "POST", body: form, headers }));
};

beforeEach(() => {
  vi.resetAllMocks();
  gate.mockResolvedValue(undefined);
  read.mockResolvedValue({ header: { number: "PI-1" }, items: [], warnings: [] });
});

describe("POST /api/assistant/documents", () => {
  it("runs the gates before reading the upload, then reads the file once, already gated, and returns the form fields", async () => {
    const res = await post({ kind: "invoice", file: new Blob([PDF], { type: "application/pdf" }) });
    expect(res.status).toBe(200);
    expect((await res.json()).data.header.number).toBe("PI-1");
    expect(gate).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0][1]).toMatchObject({ mediaType: "application/pdf" });
    expect(read.mock.calls[0][2]).toEqual({ gated: true });
    expect(read.mock.calls[0][0]).toBe(holder.user);
  });

  it("refuses without reading anything when a gate says no (off, over the day's number, ceiling)", async () => {
    gate.mockRejectedValue(new ApiError(403, "Reading documents is switched off", "AI_DOCUMENTS_OFF"));
    const res = await post({ kind: "invoice", file: new Blob([PDF]) });
    expect(res.status).toBe(403);
    expect(read).not.toHaveBeenCalled();
  });

  it("refuses an oversized upload from its declared size, before the gates or the body", async () => {
    const res = await post({ kind: "invoice", file: new Blob([PDF]) }, { "content-length": String(10 * 1024 * 1024) });
    expect(res.status).toBe(413);
    expect(gate).not.toHaveBeenCalled();
  });

  it("refuses a missing file, a missing or other kind, and a file that is not a PDF or photo", async () => {
    expect((await post({ kind: "invoice" })).status).toBe(422);
    expect((await post({ file: new Blob([PDF]) })).status).toBe(422);
    expect((await post({ kind: "payment", file: new Blob([PDF]) })).status).toBe(422);
    const res = await post({ kind: "invoice", file: new Blob([new TextEncoder().encode("<script>alert(1)</script>")]) });
    expect(res.status).toBe(415);
    expect(read).not.toHaveBeenCalled();
  });

  it("is reachable in a read-only workspace like the rest of Ivy (it saves nothing; the invoice save is the guarded write)", () => {
    expect(allowedWhenReadOnly("/api/assistant/documents")).toBe(true);
  });
});
