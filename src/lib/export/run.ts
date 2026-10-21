import { ApiError, readQuery } from "@/lib/api";
import { isAdmin, notFound } from "@/lib/access";
import type { SessionUser } from "@/lib/auth-helpers";
import { stepUpForUser } from "@/lib/mfa-server";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { findExport } from "@/lib/export/registry";
import { enforceExportLimit, MAX_CSV_ROWS, recordExport } from "@/lib/export/limits";
import { csvResponse } from "@/lib/export/stream";
import { exportFormatQuery } from "@/lib/validations/crm";

/** A fresh authenticator (or recovery) code, with its own attempt limit like the other step-up actions. */
export async function verifyStepUp(user: SessionUser, code: string | undefined) {
  await enforceRateLimit(`export-mfa:${user.id}`, LIMITS.mfa);
  await stepUpForUser(user.id, code);
}

/**
 * Runs one CSV export for the caller. `viaPost` is true only for the POST route, which is the one
 * that can carry an authenticator code; anything that needs a code is refused over GET.
 *
 * Order matters: permissions first, then the cheap checks (rate limit, row count and cap), then the
 * code (so a code isn't spent on an export that would be refused anyway), then the audit record, and
 * only then the first byte of data.
 */
export async function runCsvExport(
  req: Request,
  user: SessionUser,
  key: string,
  opts: { viaPost: boolean; includeDeleted?: boolean; code?: string },
) {
  const entity = findExport(key);
  if (!entity) throw notFound("Export");
  if (entity.adminOnly && !isAdmin(user)) throw new ApiError(403, "Only admins can export this");

  const includeDeleted = opts.includeDeleted === true;
  if (includeDeleted) {
    if (!isAdmin(user)) throw new ApiError(403, "Only admins can export deleted records");
    if (!entity.softDeleted) throw new ApiError(422, "This area has no deleted records", "VALIDATION_ERROR");
  }
  const needsCode = entity.stepUp || includeDeleted;
  if (needsCode && !opts.viaPost) {
    throw new ApiError(422, "This export needs a verification code", "STEP_UP_REQUIRED");
  }

  const { format } = readQuery(req, exportFormatQuery);
  await enforceExportLimit(user);
  const plan = await entity.plan(user, req, { includeDeleted });
  if (plan.total > MAX_CSV_ROWS) {
    throw new ApiError(
      422,
      `This export has ${plan.total} rows; the limit is ${MAX_CSV_ROWS}. Narrow it with filters.`,
      "EXPORT_TOO_LARGE",
    );
  }
  if (needsCode) await verifyStepUp(user, opts.code);

  await recordExport(req, user, { entity: entity.file, format, rows: plan.total, filters: plan.filters });
  return csvResponse(entity.file, plan.headers, plan.batches(), MAX_CSV_ROWS);
}
