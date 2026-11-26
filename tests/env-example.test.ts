// Every environment variable the code reads is documented in .env.example, and everything documented there is still
// used. Add a setting: read it in the code, then add it to .env.example (commented out with its default if optional).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SKIP = new Set(["node_modules", ".git", ".next", "tests", "coverage", "dist", "e2e"]);

// Read by the code but never set by hand in .env: the platform (Node, Next.js, Vercel, CI) provides them.
const SET_BY_PLATFORM = new Set(["NODE_ENV", "NEXT_RUNTIME", "NEXT_PHASE", "CI", "VERCEL", "VERCEL_URL", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_GIT_COMMIT_SHA"]);
// Safety switches for the scripts that wipe a database (scripts/safe-target.ts): set for one command only, never kept in .env.
const PER_COMMAND = new Set(["WIPE_FORCE", "CONFIRM_WIPE"]);

function sources(dir = ROOT): { file: string; text: string }[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    if (!/\.(ts|tsx|mjs|js|cjs)$/.test(name) || /\.(test|spec)\./.test(name)) return [];
    return [{ file: relative(ROOT, path), text: readFileSync(path, "utf8") }];
  });
}

const code = sources();
// process.env.NAME, process.env["NAME"], and env.NAME (several modules take `env = process.env` as a parameter).
const reads = new Map<string, string>();
for (const { file, text } of code) {
  for (const m of text.matchAll(/\b(?:process\.)?env\.([A-Z][A-Z0-9_]*)\b|process\.env\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\]/g)) {
    const name = m[1] ?? m[2];
    if (!reads.has(name)) reads.set(name, file);
  }
}
const documented = [...readFileSync(join(ROOT, ".env.example"), "utf8").matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
const allCode = code.map((c) => c.text).join("\n");

describe(".env.example", () => {
  it("the scan finds settings read each way", () => {
    expect(reads.has("DEFAULT_PHONE_COUNTRY_CODE")).toBe(true); // process.env.NAME
    expect(reads.has("LEGAL_ENTITY_NAME")).toBe(true); // env.NAME
  });

  it("lists every setting the code reads", () => {
    const missing = [...reads].filter(([name]) => !documented.includes(name) && !SET_BY_PLATFORM.has(name) && !PER_COMMAND.has(name));
    expect(missing.map(([name, file]) => `${name} (${file})`)).toEqual([]);
  });

  it("lists nothing the code no longer uses", () => {
    // Some settings are read through a table of names (src/lib/ai/included.ts) or a passed-in object, so a name counts as
    // used when it appears anywhere in the code.
    const unused = documented.filter((name) => !new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`).test(allCode));
    expect(unused).toEqual([]);
  });

  it("does not list the per-command wipe switches, so nobody keeps them set", () => {
    expect(documented.filter((name) => PER_COMMAND.has(name))).toEqual([]);
  });
});
