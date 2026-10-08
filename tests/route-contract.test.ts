import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every handler under /api/admin and /api/me must go through authed(): that is where the per-user
// rate limit, the role check and the audit trail live.
const root = join(__dirname, "..", "src", "app", "api");

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? routeFiles(full) : name === "route.ts" ? [full] : [];
  });
}

describe("route contract", () => {
  const files = [...routeFiles(join(root, "admin")), ...routeFiles(join(root, "me"))];
  it("finds the routes", () => expect(files.length).toBeGreaterThanOrEqual(12));
  for (const file of files) {
    it(`${file.slice(root.length + 1).replace(/\\/g, "/")} uses authed()`, () => {
      const src = readFileSync(file, "utf8");
      expect(src).toMatch(/export const (GET|POST|PATCH|PUT|DELETE) = authed/);
      expect(src).not.toMatch(/export (async )?function (GET|POST|PATCH|PUT|DELETE)/);
      expect(src).not.toContain("requireApiUser");
    });
  }
});
