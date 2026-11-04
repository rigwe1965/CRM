import { describe, expect, it } from "vitest";
import { pickHeading } from "@/lib/client/document-upload";

describe("the choice AI shows when it could not place a picture", () => {
  it("names what is being chosen, so a receipt's list is not headed as a customer's", () => {
    expect(pickHeading("deal")).toBe("Choose the deal");
    expect(pickHeading("customer")).toBe("Choose the customer");
  });
});
