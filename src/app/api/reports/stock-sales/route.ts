import { db } from "@/lib/db";
import { ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { ownerScope, tenantScope } from "@/lib/access";
import { loadLowStock } from "@/lib/automations/settings";
import { loadStock, withLowStock } from "@/lib/stock";
import { sellThrough } from "@/lib/receivables";
import { csvReport, wantsCsv } from "@/lib/report-csv";

export const dynamic = "force-dynamic";

/** GET /api/reports/stock-sales: each product, colour and length ranked by pieces sold, with what was bought, what is on hand and whether it is low. ?format=csv downloads it. */
export const GET = authed(async ({ req, user }) => {
  const [stock, levels, config] = await Promise.all([
    loadStock(ownerScope(user)),
    db.stockThreshold.findMany({ where: tenantScope(user), select: { key: true, threshold: true } }),
    loadLowStock(user.tenantId),
  ]);
  const rows = sellThrough(withLowStock(stock.rows, levels, config.defaultThreshold));
  if (wantsCsv(req)) {
    return csvReport(user, req, "stock-sales", ["Product", "Colour", "Length (in)", "Bought", "Sold", "On hand", "Sold % of bought", "Low"], rows.map((r) => [r.product, r.color, r.lengthInches, r.bought, r.sold, r.onHand, r.sellThrough, r.low ? "yes" : ""]));
  }
  return ok({ rows });
});
