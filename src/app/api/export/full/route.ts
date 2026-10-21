import { ApiError, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { EXPORTS } from "@/lib/export/registry";
import { enforceExportLimit, MAX_FULL_ROWS, recordExport } from "@/lib/export/limits";
import { verifyStepUp } from "@/lib/export/run";
import { zipResponse } from "@/lib/export/zip";
import { exportPostBody } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

/**
 * POST /api/export/full: admin only. A zip with one CSV per area (contacts, deals, payments, invoices,
 * stock, tasks, activities, the audit log and the rest), including soft-deleted records, as a copy to
 * keep offline. It is NOT a restore tool: use pg_dump for that (see TECHNICIAN.md).
 * Needs a fresh authenticator code. Body: { code?: string }.
 *
 * Every area is counted first and the whole export is refused if any one is over the limit, so a
 * copy is never silently cut short.
 */
export const POST = authed(async ({ req, user }) => {
  const { code } = await readBody(req, exportPostBody);
  await enforceExportLimit(user);

  const entries = Object.values(EXPORTS);
  const plans = await Promise.all(entries.map((e) => e.plan(user, req, { includeDeleted: e.softDeleted })));
  const tooBig = entries.flatMap((e, i) => (plans[i].total > MAX_FULL_ROWS ? [`${e.file} (${plans[i].total})`] : []));
  if (tooBig.length) {
    throw new ApiError(
      422,
      `Too many rows for one export, limit ${MAX_FULL_ROWS} per file: ${tooBig.join(", ")}. Use pg_dump for a full backup.`,
      "EXPORT_TOO_LARGE",
    );
  }
  await verifyStepUp(user, code);

  const counts = Object.fromEntries(entries.map((e, i) => [e.file, plans[i].total]));
  const total = Object.values(counts).reduce((s, c) => s + c, 0);
  await recordExport(req, user, {
    entity: "full",
    format: "zip",
    rows: total,
    filters: { files: counts },
    summary: `Full data export: ${total} rows in ${entries.length} files`,
  });

  const now = new Date();
  const readme = [
    "Ivycandy Hair CRM: full data export",
    `Created: ${now.toISOString()}`,
    `By: ${user.email ?? user.id}`,
    "",
    "One CSV per area. Soft-deleted records are included (see the deletedAt column).",
    "Money is per row, next to its own currency; amounts in different currencies are never added together.",
    "This is a copy for reading and keeping. It cannot restore the CRM: use a database backup (pg_dump) for that.",
    "It contains customer personal data and payment records. Store it encrypted and delete copies you no longer need.",
    "",
    "Rows per file:",
    ...Object.entries(counts).map(([file, count]) => `  ${file}.csv: ${count}`),
    "",
  ].join("\r\n");

  return zipResponse(
    `ivycandy-crm-export-${now.toISOString().slice(0, 10)}.zip`,
    entries.map((e, i) => ({ name: `${e.file}.csv`, headers: plans[i].headers, batches: plans[i].batches() })),
    readme,
    MAX_FULL_ROWS,
  );
}, "ADMIN");
