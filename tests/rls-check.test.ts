import { describe, expect, it, vi } from "vitest";
import { rowLevelSecurityWarning } from "@/lib/rls-check";

const client = (rows: unknown[]) => ({ $queryRaw: vi.fn(async () => rows) }) as never;

describe("rowLevelSecurityWarning", () => {
  it("is silent for a restricted role that doesn't own the tables", async () => {
    expect(await rowLevelSecurityWarning(client([{ bypass: false, owner: false }]))).toBeNull();
  });
  it("warns for a superuser or BYPASSRLS role", async () => {
    expect(await rowLevelSecurityWarning(client([{ bypass: true, owner: false }]))).toMatch(/bypasses row-level security/);
  });
  it("warns for the table owner", async () => {
    expect(await rowLevelSecurityWarning(client([{ bypass: false, owner: true }]))).toMatch(/owner of the tables/);
  });
  it("warns when it can't tell", async () => {
    expect(await rowLevelSecurityWarning(client([]))).toMatch(/not checked/);
  });
});
