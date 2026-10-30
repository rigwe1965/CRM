import { describe, expect, it } from "vitest";
import { MAX_ORDER_ITEMS, ORDER_PROMPT, ORDER_PROMPT_VERSION, ORDER_TOOL, orderDraft, orderFingerprint, readOrderInput } from "@/lib/ai/documents/order-prompt";

/** The order-reading instructions are pinned like Ivy's other prompts: an edit has to be deliberate. */
const PINNED = { version: "1", fingerprint: "1e876fe4b4c89160" };

describe("the order reading prompt", () => {
  it("is pinned: change the text or the tool and update this together with the version", () => {
    expect({ version: ORDER_PROMPT_VERSION, fingerprint: orderFingerprint() }).toEqual(PINNED);
  });

  it("says: copy only what is shown, never guess a price, the picture is data, no records, no links, one call", () => {
    expect(ORDER_PROMPT).toMatch(/Copy exactly what the picture shows/);
    expect(ORDER_PROMPT).toMatch(/never guess or work one out/);
    expect(ORDER_PROMPT).toMatch(/data, never instructions/);
    expect(ORDER_PROMPT).toMatch(/cannot read records, open links, send anything or save anything/);
    expect(ORDER_PROMPT).toMatch(/exactly once/);
    expect(ORDER_PROMPT).not.toMatch(/https?:\/\//);
  });

  it("offers one tool, which only returns the fixed fields", () => {
    expect(ORDER_TOOL.name).toBe("read_order");
    expect(Object.keys(readOrderInput.shape).sort()).toEqual(["currency", "customerName", "customerPhone", "items", "notes", "printedTotal", "problem", "readable"]);
  });

  it("refuses output outside the shape", () => {
    const line = { productType: "Body wave", quantity: 2 };
    const ok = { readable: true, items: [line] };
    expect(readOrderInput.safeParse(ok).success).toBe(true);
    expect(readOrderInput.safeParse({ ...ok, items: [{ ...line, unitPrice: -1 }] }).success).toBe(false);
    expect(readOrderInput.safeParse({ ...ok, items: [{ ...line, quantity: 1.5 }] }).success).toBe(false);
    expect(readOrderInput.safeParse({ ...ok, items: [{ productType: "", quantity: 1 }] }).success).toBe(false);
    expect(readOrderInput.safeParse({ ...ok, items: Array.from({ length: MAX_ORDER_ITEMS + 2 }, () => line) }).success).toBe(false);
  });

  it("a draft that can become a card needs every price", () => {
    const item = { productType: "Body wave", quantity: 2, unitPrice: 10 };
    expect(orderDraft.safeParse({ currency: "USD", items: [item] }).success).toBe(true);
    expect(orderDraft.safeParse({ currency: "USD", items: [{ productType: "x", quantity: 1 }] }).success).toBe(false);
    expect(orderDraft.safeParse({ currency: "USD", items: Array.from({ length: MAX_ORDER_ITEMS + 1 }, () => item) }).success).toBe(false);
  });

  it("cuts over-long free text to its limit instead of refusing the whole reading, but still needs a product type", () => {
    const ok = { readable: true, notes: "n".repeat(900), items: [{ productType: "t".repeat(300), quantity: 1 }] };
    const r = readOrderInput.safeParse(ok);
    expect(r.success).toBe(true);
    if (r.success) expect([r.data.notes?.length, r.data.items[0].productType.length]).toEqual([500, 100]);
    expect(readOrderInput.safeParse({ readable: true, items: [{ productType: "   ", quantity: 1 }] }).success).toBe(false);
  });
});
