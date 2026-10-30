import { describe, expect, it } from "vitest";
import { flagForeignContent } from "@/lib/ai/draft-check";

describe("flagForeignContent", () => {
  it("lets an ordinary reminder through: amounts, dates and order numbers are not flagged", () => {
    expect(flagForeignContent('Hi Ada, a quick reminder that 400.00 USD for your order "Wholesale Bundles" was due on 2026-10-25. Instalment 2 of 3. Thank you.')).toBeNull();
    expect(flagForeignContent("Hello, order #1042 ships on 12/11/2026.")).toBeNull();
  });

  it("flags a link, and says what it found", () => {
    const w = flagForeignContent("Please pay at https://pay.evil.example/x9 today.");
    expect(w).toMatch(/contains a link \(https:\/\/pay\.evil\.example\/x9\) that is not from your records/);
  });

  it("flags an email address, a bank-account style number and a spaced phone number that are not the contact's", () => {
    expect(flagForeignContent("Send it to billing@evil.example")).toMatch(/email address \(billing@evil\.example\)/);
    expect(flagForeignContent("Our new account number is 0123456789, please use it.")).toMatch(/long number \(0123456789\)/);
    expect(flagForeignContent("Call me on +234 801 111 2222 instead.")).toMatch(/long number/);
  });

  it("does not flag what the CRM already holds for that contact", () => {
    expect(flagForeignContent("I will message you on +234 801 111 1111", ["+2348011111111"])).toBeNull();
    expect(flagForeignContent("Write to ada@x.test", ["ada@x.test"])).toBeNull();
    expect(flagForeignContent("Pay here: https://pay.example/link/abc", ["https://pay.example/link/abc"])).toBeNull();
  });

  it("lists at most three findings, once each", () => {
    const w = flagForeignContent("a@x.test a@x.test b@x.test c@x.test d@x.test https://l.example");
    expect(w!.match(/\(/g)!.length).toBe(3);
  });
});
