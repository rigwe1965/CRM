import { z } from "zod";
import { ok, readQuery } from "@/lib/api";
import { authed } from "@/lib/route";
import { ownerScope } from "@/lib/access";
import { buildUpcoming, loadReceivableDeals } from "@/lib/receivables";
import { csvReport, wantsCsv } from "@/lib/report-csv";

export const dynamic = "force-dynamic";

const upcomingQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(30), format: z.enum(["csv"]).optional() });

/** GET /api/reports/upcoming?days=30: instalments falling due in the next days (default 30), per currency. Sales users see only their own deals. ?format=csv downloads them. */
export const GET = authed(async ({ req, user }) => {
  const { days } = readQuery(req, upcomingQuery);
  const { deals, truncated } = await loadReceivableDeals(ownerScope(user));
  const report = buildUpcoming(deals, days);
  if (wantsCsv(req)) {
    return csvReport(user, req, "upcoming-instalments", ["Due date", "Customer", "Deal", "Currency", "Amount"], report.items.map((i) => [i.dueDate, i.customer, i.title, i.currency, i.amount]));
  }
  return ok({ ...report, truncated });
});
