import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A Preview build (every pull request) must never migrate the database: on Vercel the Neon integration's variables
// can reach Preview, and `prisma migrate deploy` would then change the production schema.
const script = (JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }).scripts["vercel-build"];

describe("vercel-build", () => {
  it("migrates only on a production build, and a failed migration stops the build", () => {
    const guard = script.indexOf('[ "$VERCEL_ENV" = "production" ]');
    const migrate = script.indexOf("prisma migrate deploy");
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(migrate).toBeGreaterThan(guard);
    // The migration is inside the if ... fi, and `next build` comes after it, joined with && so it is skipped if the migration fails.
    expect(script).toMatch(/^if \[ "\$VERCEL_ENV" = "production" \]; then .*prisma migrate deploy; fi && next build$/);
  });

  it("still falls back to the Neon integration's direct URL for the migration", () => {
    expect(script).toContain('DIRECT_URL="${DIRECT_URL:-$DATABASE_URL_UNPOOLED}"');
  });
});
