import { z } from "zod";
import { ok, readQuery } from "@/lib/api";
import { authed } from "@/lib/route";
import { loadSalespeople } from "@/lib/receivables";
import { csvReport, wantsCsv } from "@/lib/report-csv";

export const dynamic = "force-dynamic";

const salespeopleQuery = z.object({ months: z.coerce.number().int().min(1).max(24).default(12), format: z.enum(["csv"]).optional() });

/**
 * GET /api/reports/salespeople?months=12: deals won and lost, conversion, value won, open pipeline and money collected per
 * salesperson, kept per currency. Admins only. ?format=csv downloads one row per salesperson and currency.
 */
export const GET = authed(async ({ req, user }) => {
  const { months } = readQuery(req, salespeopleQuery);
  const people = await loadSalespeople(user.tenantId, months);
  if (wantsCsv(req)) {
    const rows = people.flatMap((p) => {
      const currencies = [...new Set([...Object.keys(p.wonValue), ...Object.keys(p.openValue), ...Object.keys(p.collected)])].sort();
      return (currencies.length ? currencies : [""]).map((c) => [p.name, c, p.won, p.lost, p.conversion, p.wonValue[c] ?? 0, p.openDeals, p.openValue[c] ?? 0, p.collected[c] ?? 0]);
    });
    return csvReport(user, req, "salespeople", ["Salesperson", "Currency", "Won", "Lost", "Conversion %", "Value won", "Open deals", "Open pipeline", "Collected"], rows);
  }
  return ok({ months, people });
}, "ADMIN");
