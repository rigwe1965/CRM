import { db } from "@/lib/db";
import { ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { ownerScope, tenantScope } from "@/lib/access";
import { loadLowStock } from "@/lib/automations/settings";
import { loadStock, withLowStock } from "@/lib/stock";

export const dynamic = "force-dynamic";

/**
 * GET /api/stock: pieces on hand per product, colour and length (bought on invoices minus sold on
 * deal items), plus sold items that couldn't be matched to an invoice line. Each row carries `key`,
 * its own low-stock level (`threshold`, null = business default), the `level` it is held to and whether it is `low`.
 */
export const GET = authed(async ({ user }) => {
  const [stock, levels, config] = await Promise.all([
    loadStock(ownerScope(user)),
    db.stockThreshold.findMany({ where: tenantScope(user), select: { key: true, threshold: true } }),
    loadLowStock(user.tenantId),
  ]);
  return ok({
    ...stock,
    rows: withLowStock(stock.rows, levels, config.defaultThreshold),
    defaultThreshold: config.defaultThreshold,
    alertsOn: config.enabled,
  });
});
