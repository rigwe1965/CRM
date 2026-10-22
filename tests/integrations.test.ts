import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 3 of MULTI_TENANCY_PLAN.md: the settings store on its own, with an in-memory table. The real database and the
// two-business behaviour are in tenant-integrations.test.ts.

const { rows, db } = vi.hoisted(() => {
  const rows: { tenantId: string; kind: string; config: string }[] = [];
  const db = {
    tenantIntegration: {
      findFirst: vi.fn(async ({ where }: { where: { tenantId: string; kind: string } }) => rows.find((r) => r.tenantId === where.tenantId && r.kind === where.kind) ?? null),
      upsert: vi.fn(async ({ create, update }: { create: (typeof rows)[number]; update: { config: string } }) => {
        const hit = rows.find((r) => r.tenantId === create.tenantId && r.kind === create.kind);
        if (hit) hit.config = update.config;
        else rows.push({ tenantId: create.tenantId, kind: create.kind, config: create.config });
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  };
  return { rows, db };
});
vi.mock("@/lib/db", () => ({ db }));

import { getIntegration, saveIntegration, stripeSettings, whatsappSettings, leadFormSettings } from "@/lib/integrations";
import { DEFAULT_TENANT_ID } from "@/lib/tenant";

const STRIPE = { secretKey: "sk_test_abcdef123", webhookSecret: "whsec_abcdef123" };

beforeEach(() => {
  rows.length = 0;
  process.env.NEXTAUTH_SECRET = "test-secret-test-secret-0123456789ab";
  for (const k of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "LEAD_FORM_ORIGINS"]) delete process.env[k];
});

describe("integration settings", () => {
  it("round-trips through encryption without storing anything readable", async () => {
    await saveIntegration("t1", "STRIPE", STRIPE, "u1");
    expect(rows[0].config).not.toContain("sk_test");
    expect(await getIntegration("t1", "STRIPE")).toEqual({ settings: STRIPE, source: "settings" });
  });

  it("is per business: one business's settings are not found for another", async () => {
    await saveIntegration("t1", "STRIPE", STRIPE, "u1");
    expect(await getIntegration("t2", "STRIPE")).toBeNull();
  });

  it("refuses a row that was copied under another business or service", async () => {
    await saveIntegration("t1", "STRIPE", STRIPE, "u1");
    rows.push({ tenantId: "t2", kind: "STRIPE", config: rows[0].config });
    rows.push({ tenantId: "t1", kind: "WHATSAPP", config: rows[0].config });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await getIntegration("t2", "STRIPE")).toBeNull();
    expect(await getIntegration("t1", "WHATSAPP")).toBeNull();
  });

  it("lets only the original business fall back to the environment, and saved settings win", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fromenv123";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_fromenv123";
    expect(await getIntegration("t2", "STRIPE")).toBeNull();
    expect(await getIntegration(DEFAULT_TENANT_ID, "STRIPE")).toMatchObject({ source: "env", settings: { secretKey: "sk_test_fromenv123" } });
    await saveIntegration(DEFAULT_TENANT_ID, "STRIPE", STRIPE, "u1");
    expect(await getIntegration(DEFAULT_TENANT_ID, "STRIPE")).toMatchObject({ source: "settings", settings: STRIPE });
  });

  it("needs both Stripe values from the environment", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fromenv123";
    expect(await getIntegration(DEFAULT_TENANT_ID, "STRIPE")).toBeNull();
  });

  it("validates what a business saves", () => {
    expect(stripeSettings.safeParse({ ...STRIPE, secretKey: "pk_test_nope" }).success).toBe(false);
    expect(whatsappSettings.safeParse({ accessToken: "x".repeat(20), phoneNumberId: "+4915906462275", appSecret: "y".repeat(20), verifyToken: "z".repeat(16) }).success).toBe(false);
    expect(leadFormSettings.safeParse({ origins: ["http://shop.test"] }).success).toBe(false); // https only
    expect(leadFormSettings.parse({ origins: ["https://shop.test/"] }).origins).toEqual(["https://shop.test"]);
    expect(leadFormSettings.safeParse({ origins: ["http://localhost:3000"] }).success).toBe(true);
  });
});
