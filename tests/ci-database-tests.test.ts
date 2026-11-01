import { describe, expect, it } from "vitest";

// The isolation and money tests need a real database and silently skip without TEST_DATABASE_URL. That is fine on a
// laptop, but in CI a skip would hide the very checks that keep one business out of another's data, so CI must have it.
describe("CI runs the database tests", () => {
  it("has TEST_DATABASE_URL set whenever tests run in CI", () => {
    if (process.env.CI !== "true") return;
    expect(process.env.TEST_DATABASE_URL, "set TEST_DATABASE_URL in the verify job of .github/workflows/ci.yml").toBeTruthy();
  });
});
