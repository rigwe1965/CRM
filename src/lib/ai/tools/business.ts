import { z } from "zod";
import { db } from "@/lib/db";
import { loadLowStock } from "@/lib/automations/settings";
import { buildReports } from "@/lib/reports";
import { loadStock, withLowStock } from "@/lib/stock";
import { defineTool } from "@/lib/ai/tools/types";

/** Tools over the shop itself: stock on hand and sales reports. */

const MAX_STOCK_ROWS = 40;

export const stockLevels = defineTool({
  name: "stock_levels",
  description:
    "Pieces on hand per product, colour and length (bought on supplier invoices, minus sold on deals, plus manual adjustments), with each row's low-stock level and whether it is low. Optionally only rows matching a word, or only low ones.",
  schema: z.object({
    query: z.string().trim().max(60).optional().describe("A word to match in the product or colour, e.g. 'body wave' or '1B'. Several words must each match."),
    onlyLow: z.boolean().optional().describe("Only rows at or below their low-stock level."),
  }),
  label: (i) => (i.onlyLow ? "Checking low stock" : i.query ? `Checking stock for “${i.query}”` : "Checking stock"),
  fallbackLabel: "Checking stock",
  run: async ({ owned }, i) => {
    const [stock, levels, config] = await Promise.all([
      loadStock(owned),
      db.stockThreshold.findMany({ where: { tenantId: owned.tenantId }, select: { key: true, threshold: true } }),
      loadLowStock(owned.tenantId),
    ]);
    const needles = (i.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const rows = withLowStock(stock.rows, levels, config.defaultThreshold).filter(
      (r) => (!i.onlyLow || r.low) && needles.every((n) => `${r.product} ${r.color} ${r.description}`.toLowerCase().includes(n)),
    );
    return {
      total: rows.length,
      rows: rows.slice(0, MAX_STOCK_ROWS).map((r) => ({
        product: r.product, color: r.color || null, lengthInches: r.lengthInches, onHand: r.onHand, bought: r.bought, sold: r.sold, adjusted: r.adjusted, lowStockLevel: r.level, low: r.low,
      })),
      truncated: rows.length > MAX_STOCK_ROWS,
      soldButNotOnAnInvoice: stock.unmatched.length,
    };
  },
});

export const salesReport = defineTool({
  name: "sales_report",
  description: "Sales reporting for the last few months: money received per month (per currency), the average days from order to final payment, best-selling products, and where contacts came from.",
  schema: z.object({ months: z.number().int().min(1).max(24).default(6) }),
  label: (i) => `Building a ${i.months}-month sales report`,
  fallbackLabel: "Building a sales report",
  run: ({ owned, now }, i) => buildReports(owned, i.months, now),
});
