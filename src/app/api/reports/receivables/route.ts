import { ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { ownerScope } from "@/lib/access";
import { BUCKETS, buildReceivables, loadReceivableDeals } from "@/lib/receivables";
import { csvReport, wantsCsv } from "@/lib/report-csv";

export const dynamic = "force-dynamic";

/**
 * GET /api/reports/receivables: what customers still owe, by how late it is (not yet due, 1-30, 31-60, more than 60 days
 * late, no due date), per currency, per customer and per deal. Sales users see only their own deals. ?format=csv downloads the deals.
 */
export const GET = authed(async ({ req, user }) => {
  const { deals, truncated } = await loadReceivableDeals(ownerScope(user));
  const report = buildReceivables(deals);
  if (wantsCsv(req)) {
    return csvReport(
      user,
      req,
      "receivables",
      ["Customer", "Deal", "Currency", "Total", "Paid", "Balance", "Overdue", "Oldest days late", ...BUCKETS],
      report.deals.map((d) => [d.customer, d.title, d.currency, d.total, d.paid, d.balance, d.overdue, d.oldestDaysLate, ...BUCKETS.map((b) => d.buckets[b])]),
    );
  }
  return ok({ ...report, truncated });
});
