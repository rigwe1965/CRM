import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** A real Anthropic key must never be saved in the repository (chat, scripts, docs): keys live in Settings or in the git-ignored .env.eval. */
describe("no Anthropic key in the repository", () => {
  it("finds no sk-ant- key in any tracked file", () => {
    const files = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter((f) => f && !/\.(png|jpe?g|webp|pdf|ico|woff2?)$/i.test(f));
    const real = /sk-ant-(?:api|usr|admin|oat)?[A-Za-z0-9_-]{30,}/g;
    // The made-up keys the tests use say so in the key itself.
    const isReal = (text: string) => (text.match(real) ?? []).some((k) => !k.includes("this-is"));
    const hits = files.filter((f) => {
      try {
        return isReal(readFileSync(f, "utf8"));
      } catch {
        return false;
      }
    });
    expect(hits).toEqual([]);
  });
});
