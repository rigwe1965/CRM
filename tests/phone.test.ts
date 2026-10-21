import { describe, expect, it } from "vitest";
import { toE164 } from "@/lib/phone";
import { whatsappUrl } from "@/lib/client/whatsapp";
import { createActivitySchema } from "@/lib/validations/crm";

describe("toE164", () => {
  it("keeps international numbers and strips formatting", () => {
    expect(toE164("+4915906462275")).toBe("+4915906462275");
    expect(toE164(" +49 (159) 0646-2275 ")).toBe("+4915906462275");
    expect(toE164("004915906462275")).toBe("+4915906462275");
  });

  it("completes a national number only when a default calling code is given", () => {
    expect(toE164("0803 123 4567")).toBeNull();
    expect(toE164("0803 123 4567", "234")).toBe("+2348031234567");
  });

  it("refuses to guess", () => {
    expect(toE164(null)).toBeNull();
    expect(toE164("")).toBeNull();
    expect(toE164("call after 5")).toBeNull();
    expect(toE164("+123")).toBeNull();
    expect(toE164("803 123 4567", "234")).toBeNull();
    expect(toE164("0803 123 4567", "abc")).toBeNull();
  });
});

describe("whatsappUrl", () => {
  it("builds a wa.me link with digits only and an encoded prefill", () => {
    expect(whatsappUrl("+4915906462275")).toBe("https://wa.me/4915906462275");
    expect(whatsappUrl("+4915906462275", "Hi Ada & co")).toBe("https://wa.me/4915906462275?text=Hi+Ada+%26+co");
  });
});

describe("activity schema", () => {
  it("accepts a WhatsApp activity with a direction", () => {
    const r = createActivitySchema.safeParse({ type: "WHATSAPP", direction: "IN", subject: "Asked about lace" });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown direction", () => {
    expect(createActivitySchema.safeParse({ type: "WHATSAPP", direction: "SIDEWAYS", subject: "x" }).success).toBe(false);
  });
});
