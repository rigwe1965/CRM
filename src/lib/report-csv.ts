import { CSV_BOM, csvLine } from "@/lib/export/csv";
import { audit } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth-helpers";

export const wantsCsv = (req: Request) => new URL(req.url).searchParams.get("format") === "csv";

/**
 * A report as a CSV download. The file name is fixed here plus the date, never built from user input. Every download is
 * written to the audit log first (customer names and balances leave the system), like the other exports.
 */
export async function csvReport(user: SessionUser, req: Request, report: string, headers: readonly string[], rows: readonly (readonly unknown[])[]) {
  await audit(user, { action: "report.exported", entity: "report", summary: `Downloaded the ${report} report as CSV (${rows.length} rows)`, data: { report, rows: rows.length } }, req);
  const name = `${report}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(CSV_BOM + csvLine(headers) + rows.map(csvLine).join(""), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
