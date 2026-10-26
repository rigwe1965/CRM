import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { loadLowStock } from "@/lib/automations/settings";
import { lowStockEmail } from "@/lib/email-templates";
import { trySendMail } from "@/lib/mail";
import { senderFor } from "@/lib/sender";
import { loadStock, withLowStock } from "@/lib/stock";

/** Rows listed in one email; the rest are counted ("and N more"). */
export const LOW_STOCK_EMAIL_ROWS = 50;
/** Most rows one run will mark as alerted, so a first run on a huge catalogue stays bounded. */
export const LOW_STOCK_RUN_LIMIT = 500;

/**
 * Once a day: emails the business's active admins the stock rows that have newly dropped to or below their
 * level. Stock is counted for the whole business, not for one user. A row is alerted once per dip: it is
 * marked only after the provider accepted the email (so a failed send is retried tomorrow), and the mark is
 * cleared once the row is back above its level (or no longer has one), so the next dip alerts again.
 */
export async function runLowStockAlerts(tenantId: string) {
  const config = await loadLowStock(tenantId);
  const result = { alerted: 0, failed: 0 };
  if (!config.enabled) return result;

  const [{ rows }, saved] = await Promise.all([
    loadStock({ tenantId }),
    db.stockThreshold.findMany({ where: { tenantId }, select: { key: true, product: true, threshold: true, alertedAt: true } }),
  ]);
  const low = withLowStock(rows, saved, config.defaultThreshold).filter((r) => r.low);
  const lowKeys = new Set(low.map((r) => r.key));
  const alreadyAlerted = new Set(saved.filter((s) => s.alertedAt).map((s) => s.key));

  // Back above their level (or switched off): arm them again.
  const recovered = [...alreadyAlerted].filter((k) => !lowKeys.has(k));
  if (recovered.length) await db.stockThreshold.updateMany({ where: { tenantId, key: { in: recovered } }, data: { alertedAt: null } });

  const fresh = low.filter((r) => !alreadyAlerted.has(r.key)).slice(0, LOW_STOCK_RUN_LIMIT);
  if (fresh.length === 0) return result;

  const admins = await db.user.findMany({ where: { tenantId, role: "ADMIN", isActive: true }, select: { email: true } });
  if (admins.length === 0) return result;

  const tenant = await db.tenant.findFirst({ where: { id: tenantId }, select: { name: true, brandName: true } });
  const brand = (tenant?.brandName || tenant?.name || "CRM").slice(0, 60);
  const listed = fresh.slice(0, LOW_STOCK_EMAIL_ROWS);
  const mail = lowStockEmail({
    brand,
    rows: listed.map((r) => ({ product: r.product, color: r.color, lengthInches: r.lengthInches, onHand: r.onHand, level: r.level })),
    more: fresh.length - listed.length,
  });
  const sent = await trySendMail({ to: admins.map((a) => a.email), ...mail, from: await senderFor(tenantId, brand) });
  if (!sent) {
    result.failed = fresh.length;
    return result;
  }

  const now = new Date();
  for (const r of fresh) {
    await db.stockThreshold.upsert({
      where: { tenantId_key: { tenantId, key: r.key } },
      create: { tenantId, key: r.key, product: r.product, color: r.color, lengthInches: r.lengthInches, threshold: null, alertedAt: now },
      update: { alertedAt: now },
    });
  }
  result.alerted = fresh.length;
  await audit({ email: "automation", tenantId }, { action: "automation.low_stock", entity: "stock", summary: `${fresh.length} item${fresh.length === 1 ? "" : "s"} low, emailed to ${admins.length} admin${admins.length === 1 ? "" : "s"}` });
  return result;
}

/** How many stock rows are low right now (shown in Settings before an admin switches the alerts on). */
export async function countLowStock(tenantId: string, defaultThreshold: number) {
  const [{ rows }, saved] = await Promise.all([
    loadStock({ tenantId }),
    db.stockThreshold.findMany({ where: { tenantId }, select: { key: true, threshold: true } }),
  ]);
  return withLowStock(rows, saved, defaultThreshold).filter((r) => r.low).length;
}
