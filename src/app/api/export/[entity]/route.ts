import { readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { runCsvExport } from "@/lib/export/run";
import { exportPostBody } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

/**
 * GET /api/export/:entity?format=csv: download what the caller can see on that screen as a file.
 * Takes the same filters as the matching list (without paging). Rows are scoped like the list, at most
 * 50,000 per file, limited to a few exports per user per few minutes, and every export is written to
 * the audit log before the first byte is sent. Admin-only areas (contacts, audit log) are refused to
 * everyone else; the audit log needs a code, so it is served by POST only.
 */
export const GET = authed<{ entity: string }>(async ({ req, user, params }) =>
  runCsvExport(req, user, params.entity, { viaPost: false }),
);

/**
 * POST /api/export/:entity: the same export, for admins who must give a fresh authenticator code:
 * the audit log, or any area with `includeDeleted: true` to add soft-deleted records.
 * Body: { code?: string, includeDeleted?: boolean }. Filters stay in the query string.
 */
export const POST = authed<{ entity: string }>(async ({ req, user, params }) => {
  const body = await readBody(req, exportPostBody);
  return runCsvExport(req, user, params.entity, { viaPost: true, includeDeleted: body.includeDeleted, code: body.code });
});
