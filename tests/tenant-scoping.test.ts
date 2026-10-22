import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { businessModels, delegateName } from "./helpers/two-tenants";

// Phase 1 of MULTI_TENANCY_PLAN.md. A guard in the style of route-contract.test.ts: it reads the source and fails
// when a query on a business table doesn't name the caller's business, so a forgotten filter is caught in CI
// instead of leaking one business's rows to another. It is a net, not a proof: the two-tenant database tests
// (tenant-isolation.test.ts) prove the behaviour.

/** A query passes when its arguments mention the tenant, or one of the scope helpers that include it. */
const SCOPED = /tenantId|tenantScope|ownerScope|authorScope|taskScope|\bowned\b|\bscope\b/;

/**
 * Files that may query without naming a tenant, with the reason. Keep this list short: a query that can name its
 * tenant should.
 */
const ALLOWED: Record<string, string> = {
  "src/lib/payments.ts": "reads the payments and instalments of deals the caller already fetched through ownerScope",
  "src/lib/auth.ts": "sign-in and session checks look a user up by their own id or email, before any tenant is known",
  "src/lib/mfa-server.ts": "acts on the signed-in user's own row",
  "src/lib/signin-limits.ts": "looks a user up by email before sign-in, before any tenant is known",
  "src/lib/tokens.ts": "password-reset and invite tokens belong to a user, not a tenant",
  "src/app/api/auth/mfa-check/route.ts": "public, before sign-in: looks a user up by email",
  "src/app/api/me/route.ts": "the signed-in user's own row",
  "src/app/api/me/password/route.ts": "the signed-in user's own row",
  "src/app/api/me/sessions/route.ts": "the signed-in user's own row",
  "src/app/api/me/mfa/setup/route.ts": "the signed-in user's own row",
  "src/app/api/me/mfa/enable/route.ts": "the signed-in user's own row",
  "src/app/api/me/mfa/disable/route.ts": "the signed-in user's own row",
  "src/app/api/password/forgot/route.ts": "public, before sign-in: looks a user up by email",
  "src/app/api/password/reset/route.ts": "public, before sign-in: acts on the user named by the reset token",
  "src/lib/audit.ts": "writes one audit row; the tenant comes from the actor",
  "src/lib/notifications.ts": "the daily reminder job reads across businesses on purpose (one digest per user, skipping suspended businesses)",
  "src/app/api/health/route.ts": "a connectivity check that reads no business data",
};

const MODELS = businessModels().map(delegateName);
const CALL = new RegExp(`\\b(?:db|tx|prisma)\\.(${MODELS.join("|")})\\.(\\w+)\\(`, "g");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

/** The text between the call's parentheses. */
function args(src: string, open: number) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
}

/** True when the call's `where` is a name, a call or contains a spread, i.e. not just literal fields. */
function builtElsewhere(text: string) {
  const at = text.search(/\bwhere\b/);
  if (at === -1) return false;
  const rest = text.slice(at + "where".length).trimStart();
  if (!rest.startsWith(":")) return true; // shorthand: `{ where }`
  const value = rest.slice(1).trimStart();
  if (!value.startsWith("{")) return true; // `where: helper(user)`, `where: owned`
  let depth = 0;
  let end = value.length;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "{") depth++;
    else if (value[i] === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  return /\.\.\.|\w\(/.test(value.slice(1, end));
}

type Call = { file: string; line: number; text: string };
const calls: Call[] = [];
for (const abs of sources("src")) {
  const file = relative(".", abs).replaceAll("\\", "/");
  const src = readFileSync(abs, "utf8");
  for (const m of src.matchAll(CALL)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    calls.push({ file, line: src.slice(0, m.index).split("\n").length, text: `${m[1]}.${m[2]}(${args(src, open)})` });
  }
}

describe("tenant scoping of queries", () => {
  it("finds the queries it is meant to check", () => {
    expect(calls.length).toBeGreaterThan(100);
  });

  it("every query on a business table names the caller's business", () => {
    const unscoped = calls
      .filter((c) => !ALLOWED[c.file])
      .filter((c) => {
        if (SCOPED.test(c.text)) return false;
        // A `where` built elsewhere (a helper, a spread of `live`, an `AND` list) is scoped where it is built, so the
        // file as a whole must use a scope helper. A literal `{ id: params.id }` has nothing behind it to trust.
        return !(builtElsewhere(c.text) && SCOPED.test(readFileSync(c.file, "utf8")));
      })
      .map((c) => `${c.file}:${c.line} ${c.text.replace(/\s+/g, " ").slice(0, 110)}`);
    expect(unscoped, "name the tenant (tenantScope(user) / ownerScope(user)), or add the file to ALLOWED with a reason").toEqual([]);
  });

  it("the exempt files are real, so the list can't rot", () => {
    for (const file of Object.keys(ALLOWED)) {
      expect(() => statSync(file), file).not.toThrow();
    }
  });
});
