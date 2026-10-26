import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, audit, send, loadStock } = vi.hoisted(() => ({
  db: {
    tenant: { findFirst: vi.fn() },
    automationSetting: { findUnique: vi.fn() },
    stockThreshold: { findMany: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
    user: { findMany: vi.fn() },
  },
  audit: vi.fn(),
  send: vi.fn(),
  loadStock: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/audit", () => ({ audit }));
vi.mock("@/lib/mail", async (orig) => ({ ...(await orig<typeof import("@/lib/mail")>()), trySendMail: send, appUrl: () => "https://crm.test" }));
vi.mock("@/lib/stock", async (orig) => ({ ...(await orig<typeof import("@/lib/stock")>()), loadStock }));
vi.mock("@/lib/sender", () => ({ senderFor: async (_t: string, name: string) => `"${name}" <noreply@crm.test>` }));

import { DEFAULT_LOW_STOCK, lowStockSchema, resolveLowStock } from "@/lib/automations/config";
import { countLowStock, LOW_STOCK_EMAIL_ROWS, runLowStockAlerts } from "@/lib/automations/low-stock";
import { lowStockEmail } from "@/lib/email-templates";
import { effectiveLevel, isLow, stockKey, withLowStock } from "@/lib/stock";

const row = (product: string, onHand: number, color = "1B", lengthInches: number | null = 16) => ({
  key: stockKey(product, color, lengthInches), product, color, lengthInches, onHand, description: "", bought: onHand, sold: 0, adjusted: 0, adjustments: [], sources: [],
});

describe("stockKey", () => {
  it("names a row the same way however it is typed", () => {
    expect(stockKey("Bone Straight", "1B Color", 16)).toBe(stockKey("bone  straight", "1b", 16));
    expect(stockKey("Bone Straight", "1B", 16)).not.toBe(stockKey("Bone Straight", "1B", 18));
    expect(stockKey("Pixie curl", "", null)).toBe("pixie curl||");
  });
});

describe("low stock rules", () => {
  it("is low at or below the level, and a level of 0 never alerts", () => {
    expect(isLow(3, 3)).toBe(true);
    expect(isLow(4, 3)).toBe(false);
    expect(isLow(0, 3)).toBe(true);
    expect(isLow(-2, 3)).toBe(true); // oversold
    expect(isLow(0, 0)).toBe(false);
  });

  it("uses a row's own level, else the default", () => {
    expect(effectiveLevel(5, 3)).toBe(5);
    expect(effectiveLevel(null, 3)).toBe(3);
    expect(effectiveLevel(0, 3)).toBe(0);
    const out = withLowStock([row("A", 4), row("B", 4), row("C", 4)], [{ key: row("A", 0).key, threshold: 5 }, { key: row("B", 0).key, threshold: 0 }], 3);
    expect(out.map((r) => [r.product, r.threshold, r.level, r.low])).toEqual([
      ["A", 5, 5, true],
      ["B", 0, 0, false],
      ["C", null, 3, false],
    ]);
  });
});

describe("low-stock settings", () => {
  it("is off with a default level of 3", () => {
    expect(resolveLowStock(undefined)).toEqual(DEFAULT_LOW_STOCK);
    expect(DEFAULT_LOW_STOCK).toEqual({ enabled: false, defaultThreshold: 3 });
  });

  it("takes whole numbers from 0 and falls back to the default for a bad saved value", () => {
    expect(lowStockSchema.safeParse({ enabled: true, defaultThreshold: 0 }).success).toBe(true);
    for (const bad of [-1, 1.5, 100_001]) expect(lowStockSchema.safeParse({ enabled: true, defaultThreshold: bad }).success).toBe(false);
    expect(resolveLowStock({ enabled: true, defaultThreshold: -4 })).toEqual(DEFAULT_LOW_STOCK);
  });
});

describe("the daily alert", () => {
  const on = (over: object = {}) => db.automationSetting.findUnique.mockResolvedValue({ key: "low-stock", config: { enabled: true, defaultThreshold: 3, ...over } });

  beforeEach(() => {
    vi.clearAllMocks();
    db.automationSetting.findUnique.mockResolvedValue(null);
    db.stockThreshold.findMany.mockResolvedValue([]);
    db.user.findMany.mockResolvedValue([{ email: "boss@shop.test" }, { email: "second@shop.test" }]);
    db.tenant.findFirst.mockResolvedValue({ name: "Test Co", brandName: "Ivycandy Hair" });
    loadStock.mockResolvedValue({ rows: [row("Bone Straight", 2), row("Pixie curl", 10)], unmatched: [] });
    send.mockResolvedValue(true);
  });

  it("does nothing while off", async () => {
    expect(await runLowStockAlerts("t1")).toEqual({ alerted: 0, failed: 0 });
    expect(loadStock).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("counts the whole business, emails every active admin once, then marks the row", async () => {
    on();
    expect(await runLowStockAlerts("t1")).toEqual({ alerted: 1, failed: 0 });
    expect(loadStock).toHaveBeenCalledWith({ tenantId: "t1" });
    expect(db.user.findMany.mock.calls[0][0].where).toEqual({ tenantId: "t1", role: "ADMIN", isActive: true });
    const mail = send.mock.calls[0][0];
    expect(mail.to).toEqual(["boss@shop.test", "second@shop.test"]);
    expect(mail.subject).toBe("Low stock: 1 item to reorder");
    expect(mail.text).toContain("Bone Straight · 1B · 16\": 2 left (alert at 3)");
    expect(mail.text).not.toContain("Pixie curl");
    expect(mail.from).toContain("Ivycandy Hair");
    expect(db.stockThreshold.upsert.mock.calls[0][0]).toMatchObject({
      where: { tenantId_key: { tenantId: "t1", key: row("Bone Straight", 0).key } },
      create: { tenantId: "t1", threshold: null, alertedAt: expect.any(Date) },
      update: { alertedAt: expect.any(Date) },
    });
    expect(audit).toHaveBeenCalledWith({ email: "automation", tenantId: "t1" }, expect.objectContaining({ action: "automation.low_stock" }));
  });

  it("does not repeat an alert for a row already alerted, and clears the mark once it is restocked", async () => {
    on();
    db.stockThreshold.findMany.mockResolvedValue([
      { key: row("Bone Straight", 0).key, threshold: null, alertedAt: new Date() }, // still low: stay quiet
      { key: row("Pixie curl", 0).key, threshold: null, alertedAt: new Date() }, // back above its level: re-arm
    ]);
    expect(await runLowStockAlerts("t1")).toEqual({ alerted: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(db.stockThreshold.updateMany).toHaveBeenCalledWith({ where: { tenantId: "t1", key: { in: [row("Pixie curl", 0).key] } }, data: { alertedAt: null } });
  });

  it("re-arms a row that was alerted and then switched off or removed", async () => {
    on();
    loadStock.mockResolvedValue({ rows: [row("Bone Straight", 2)], unmatched: [] });
    db.stockThreshold.findMany.mockResolvedValue([
      { key: row("Bone Straight", 0).key, threshold: 0, alertedAt: new Date() }, // level set to "never"
      { key: "gone||", threshold: null, alertedAt: new Date() }, // no longer a stock row
    ]);
    await runLowStockAlerts("t1");
    expect(db.stockThreshold.updateMany.mock.calls[0][0].where.key.in.sort()).toEqual(["gone||", row("Bone Straight", 0).key].sort());
    expect(send).not.toHaveBeenCalled();
  });

  it("honours a row's own level and its 'never' setting", async () => {
    on();
    loadStock.mockResolvedValue({ rows: [row("A", 8), row("B", 0), row("C", 2)], unmatched: [] });
    db.stockThreshold.findMany.mockResolvedValue([
      { key: row("A", 0).key, threshold: 10, alertedAt: null },
      { key: row("B", 0).key, threshold: 0, alertedAt: null },
    ]);
    expect(await runLowStockAlerts("t1")).toEqual({ alerted: 2, failed: 0 });
    const text = send.mock.calls[0][0].text as string;
    expect(text).toContain("A · 1B");
    expect(text).toContain("C · 1B");
    expect(text).not.toContain("B · 1B");
  });

  it("marks nothing when the provider rejects the email, so tomorrow retries", async () => {
    on();
    send.mockResolvedValue(false);
    expect(await runLowStockAlerts("t1")).toEqual({ alerted: 0, failed: 1 });
    expect(db.stockThreshold.upsert).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("sends nothing and marks nothing when the business has no active admin", async () => {
    on();
    db.user.findMany.mockResolvedValue([]);
    expect(await runLowStockAlerts("t1")).toEqual({ alerted: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(db.stockThreshold.upsert).not.toHaveBeenCalled();
  });

  it("lists at most 50 rows, counts the rest, and marks them all", async () => {
    on();
    const many = Array.from({ length: LOW_STOCK_EMAIL_ROWS + 7 }, (_, n) => row(`P${n}`, 1));
    loadStock.mockResolvedValue({ rows: many, unmatched: [] });
    expect(await runLowStockAlerts("t1")).toEqual({ alerted: many.length, failed: 0 });
    expect(send.mock.calls[0][0].text).toContain("...and 7 more");
    expect(db.stockThreshold.upsert).toHaveBeenCalledTimes(many.length);
  });

  it("counts what is low now for the settings screen", async () => {
    expect(await countLowStock("t1", 3)).toBe(1);
    expect(await countLowStock("t1", 0)).toBe(0);
  });
});

describe("lowStockEmail", () => {
  const base = { brand: "Ivycandy Hair", more: 0, rows: [{ product: "Bone Straight", color: "1B", lengthInches: 16, onHand: 2, level: 3 }] };

  it("says what is low and where to look, with a single-line subject", () => {
    const m = lowStockEmail(base);
    expect(m.subject).toBe("Low stock: 1 item to reorder");
    expect(m.text).toContain("https://crm.test/stock");
    expect(m.html).toContain("Open stock");
    expect(lowStockEmail({ ...base, more: 4 }).subject).toBe("Low stock: 5 items to reorder");
  });

  it("escapes what it shows and keeps the subject on one line", () => {
    const m = lowStockEmail({ ...base, rows: [{ product: '<b>X</b>\r\nBcc: a@evil.test', color: '"q"', lengthInches: null, onHand: 0, level: 1 }] });
    expect(m.html).not.toContain("<b>X</b>");
    expect(m.html).toContain("&lt;b&gt;X&lt;/b&gt;");
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.text).not.toMatch(/\r|Bcc: a@evil.test\n/);
  });
});
