import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXPORTS } from "@/lib/export/registry";
import { FONT_FILES } from "@/lib/export/pdf";

const src = join(__dirname, "..", "src");
const rel = (f: string) => f.slice(src.length + 1).replace(/\\/g, "/");

function files(dir: string, match: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full, match) : match(name) ? [full] : [];
  });
}

const exportLib = files(join(src, "lib", "export"), (n) => n.endsWith(".ts"));
const exportRoutes = files(join(src, "app", "api", "export"), (n) => n === "route.ts");
const read = (...p: string[]) => readFileSync(join(src, ...p), "utf8");

describe("export code never touches secrets", () => {
  it("finds the files", () => {
    expect(exportLib.length).toBeGreaterThanOrEqual(8);
    expect(exportRoutes.length).toBe(3);
  });

  const FORBIDDEN =
    /passwordHash|mfaSecret|mfaRecoveryCodes|mfaLastStep|mfaEnabledAt|sessionToken|access_token|refresh_token|id_token|VerificationToken|db\.(user|account|session|verificationToken)\b/;
  for (const file of [...exportLib, ...exportRoutes]) {
    it(`${rel(file)} has no secret fields or auth tables`, () => {
      expect(readFileSync(file, "utf8")).not.toMatch(FORBIDDEN);
    });
  }

  it("selects explicit fields only (no `include`, so new columns cannot leak in)", () => {
    for (const f of ["entities.ts", "admin-entities.ts"]) {
      expect(read("lib", "export", f), f).not.toMatch(/\binclude\s*:/);
    }
  });

  it("keeps the contacts table out of the everyday areas", () => {
    const code = read("lib", "export", "entities.ts");
    expect(code).not.toMatch(/db\.contact\b/);
    expect(code).not.toMatch(/db\.auditLog\b/);
    // Customers are only ever read as first and last name there.
    expect(code).not.toMatch(/contact:\s*\{\s*select:\s*\{[^}]*(email|phone|address)/);
    expect(code).not.toMatch(/contactName\s*=\s*\{[^}]*(email|phone|address)/);
  });

  it("keeps internal margin figures out of the printable documents", () => {
    expect(read("lib", "export", "pdf.ts")).not.toMatch(/resalePrice|profit/i);
    expect(read("app", "api", "export", "[entity]", "[id]", "route.ts")).not.toMatch(/resalePrice/);
  });
});

describe("export routes", () => {
  for (const file of exportRoutes) {
    it(`${rel(file)} uses authed()`, () => {
      const code = readFileSync(file, "utf8");
      expect(code).toMatch(/export const (GET|POST) = authed/);
      expect(code).not.toMatch(/export (async )?function (GET|POST|PATCH|PUT|DELETE)/);
      expect(code).not.toContain("requireApiUser");
    });
  }

  it("never serves anything over PUT, PATCH or DELETE", () => {
    for (const file of exportRoutes) expect(readFileSync(file, "utf8"), rel(file)).not.toMatch(/export const (PUT|PATCH|DELETE)/);
  });

  it("writes the audit record before the first byte is sent, in every path", () => {
    const run = read("lib", "export", "run.ts");
    expect(run.indexOf("recordExport(")).toBeGreaterThan(-1);
    expect(run.indexOf("recordExport(")).toBeLessThan(run.indexOf("csvResponse("));
    const full = read("app", "api", "export", "full", "route.ts");
    expect(full.indexOf("recordExport(")).toBeLessThan(full.indexOf("zipResponse("));
    const docs = read("app", "api", "export", "[entity]", "[id]", "route.ts");
    expect(docs.indexOf("recordExport(")).toBeLessThan(docs.indexOf("Pdf("));
  });

  it("asks for the code only after the cheap checks, and before the audit record", () => {
    const run = read("lib", "export", "run.ts");
    const check = run.indexOf("await verifyStepUp(");
    expect(check).toBeGreaterThan(-1);
    expect(run.indexOf("await enforceExportLimit(")).toBeLessThan(check);
    expect(run.indexOf("plan.total > MAX_CSV_ROWS")).toBeLessThan(check);
    expect(check).toBeLessThan(run.indexOf("await recordExport("));
  });

  it("limits and checks the code in the full export before anything is built", () => {
    const full = read("app", "api", "export", "full", "route.ts");
    const check = full.indexOf("await verifyStepUp(");
    expect(full).toContain('"ADMIN"');
    expect(check).toBeGreaterThan(-1);
    expect(full.indexOf("await enforceExportLimit(")).toBeLessThan(check);
    expect(check).toBeLessThan(full.indexOf("await recordExport("));
  });
});

describe("registry", () => {
  it("lists every area", () => {
    expect(Object.keys(EXPORTS).sort()).toEqual(
      ["activities", "audit-log", "cashflow", "contacts", "deal-items", "deals", "instalments", "invoice-items", "invoices", "organizations", "payments", "stock", "tasks"],
    );
  });
  it("makes contacts and the audit log admin-only, and the audit log code-protected", () => {
    expect(EXPORTS.contacts).toMatchObject({ adminOnly: true, stepUp: false });
    expect(EXPORTS["audit-log"]).toMatchObject({ adminOnly: true, stepUp: true });
  });
  it("leaves every other area open to the owner's own rows only", () => {
    for (const [key, e] of Object.entries(EXPORTS)) {
      if (key === "contacts" || key === "audit-log") continue;
      expect(e.adminOnly, key).toBe(false);
      expect(e.stepUp, key).toBe(false);
    }
  });
  it("marks exactly the soft-deleted areas as having deleted rows", () => {
    const soft = Object.entries(EXPORTS).filter(([, e]) => e.softDeleted).map(([k]) => k).sort();
    expect(soft).toEqual(["contacts", "deal-items", "deals", "instalments", "organizations", "payments"]);
  });
  it("uses safe file names", () => {
    for (const e of Object.values(EXPORTS)) expect(e.file).toMatch(/^[a-z-]+$/);
  });
});

describe("pdf fonts", () => {
  it("are installed", () => {
    for (const f of Object.values(FONT_FILES)) expect(statSync(f).size, f).toBeGreaterThan(100_000);
  });
});
