import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTenantDb } from "@/lib/tenant-db";
import { withTenant } from "@/lib/tenant-context";
import { createTwoTenants, testDatabaseUrl, type TenantFixture, type TwoTenants } from "./helpers/two-tenants";

// The knowledge base against a real database holding two businesses: the default policy imports once and never over an
// admin's edit, every change keeps a version, duplicates are refused, search reads only the caller's business, and
// the other business sees nothing. Needs TEST_DATABASE_URL.

const { holder, lazy } = vi.hoisted(() => {
  const holder = { db: null as unknown };
  const lazy = (pick: () => unknown) =>
    new Proxy(
      {},
      {
        get: (_t, key) => {
          const target = pick() as Record<string | symbol, unknown>;
          const v = target[key];
          return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        },
      },
    );
  return { holder, lazy };
});
vi.mock("@/lib/db", () => ({ db: lazy(() => holder.db) }));

import { createEntry, entryHistory, importDefaultPolicy, listEntries, updateEntry } from "@/lib/ai/knowledge/service";
import { DEFAULT_POLICY } from "@/lib/ai/knowledge/ivycandy-policy";
import { searchKnowledge } from "@/lib/ai/knowledge/search";

const run = testDatabaseUrl() ? describe : describe.skip;

run("knowledge base across two businesses", () => {
  let t: TwoTenants;
  const inTenant = <T,>(f: TenantFixture, fn: () => Promise<T>) => withTenant(f.tenantId, fn);
  const admin = (f: TenantFixture) => ({ id: f.admin, tenantId: f.tenantId, role: "ADMIN", name: "Admin", email: "a@x.test", tenantWritable: true }) as never;

  beforeAll(async () => {
    t = await createTwoTenants();
    holder.db = createTenantDb(t.appDb);
  }, 60_000);
  afterAll(async () => {
    holder.db = null;
    await t?.dispose();
  });

  it("imports the shipped policy once, and again changes nothing", async () => {
    const first = await inTenant(t.a, () => importDefaultPolicy(admin(t.a)));
    expect(first.created).toBe(DEFAULT_POLICY.length);
    const again = await inTenant(t.a, () => importDefaultPolicy(admin(t.a)));
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: DEFAULT_POLICY.length });
  });

  it("never overwrites an entry an admin has edited, and keeps every version", async () => {
    const entry = (await inTenant(t.a, () => listEntries(admin(t.a)))).find((e) => e.key === "return-shipping")!;
    await inTenant(t.a, () => updateEntry(admin(t.a), entry.id, { body: "Edited by the admin: return shipping is paid by the customer for a change of mind." }));
    const result = await inTenant(t.a, () => importDefaultPolicy(admin(t.a)));
    expect(result.skippedEdited).toBe(1);
    const after = (await inTenant(t.a, () => listEntries(admin(t.a)))).find((e) => e.key === "return-shipping")!;
    expect(after).toMatchObject({ version: 2, fromDefault: false });
    expect(after.body).toContain("Edited by the admin");
    expect((await inTenant(t.a, () => entryHistory(admin(t.a), entry.id))).map((v) => v.version)).toEqual([2, 1]);
  });

  it("refuses a repeated key, title or text, and archived entries drop out of search", async () => {
    await inTenant(t.a, () => createEntry(admin(t.a), { key: "faq-gift-cards", category: "FAQ", title: "Gift cards", body: "We do not sell gift cards at the moment." }));
    await expect(inTenant(t.a, () => createEntry(admin(t.a), { key: "faq-gift-cards", category: "FAQ", title: "Other", body: "Something else entirely here." }))).rejects.toMatchObject({ status: 409 });
    await expect(inTenant(t.a, () => createEntry(admin(t.a), { key: "faq-gift-2", category: "FAQ", title: "gift  cards", body: "Different text for the same title." }))).rejects.toMatchObject({ status: 409 });
    const gift = (await inTenant(t.a, () => listEntries(admin(t.a)))).find((e) => e.key === "faq-gift-cards")!;
    expect((await inTenant(t.a, () => searchKnowledge(t.a.tenantId, "do you sell gift cards"))).results.map((e) => e.key)).toContain("faq-gift-cards");
    await inTenant(t.a, () => updateEntry(admin(t.a), gift.id, { status: "ARCHIVED" }));
    expect((await inTenant(t.a, () => searchKnowledge(t.a.tenantId, "do you sell gift cards"))).results.map((e) => e.key)).not.toContain("faq-gift-cards");
  });

  it("shows the other business nothing of it", async () => {
    const b = await inTenant(t.b, () => listEntries(admin(t.b)));
    expect(b.every((e) => e.key.startsWith("fixture-"))).toBe(true);
    expect((await inTenant(t.b, () => searchKnowledge(t.b.tenantId, "Can I return my wig?"))).results).toEqual([]);
    const aEntry = (await inTenant(t.a, () => listEntries(admin(t.a))))[0];
    await expect(inTenant(t.b, () => updateEntry(admin(t.b), aEntry.id, { title: "Hijacked" }))).rejects.toMatchObject({ status: 404 });
  });
});
