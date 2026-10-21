import { headers } from "next/headers";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { clientIp } from "@/lib/rate-limit";
import { markAudited } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth-helpers";

export const MAX_CSV_ROWS = 50_000;
/** Per file in the admin's full export, which is a copy for keeping and so is not cut short at 50,000. */
export const MAX_FULL_ROWS = 500_000;
export const MAX_PDF_LINES = 2_000;
export const EXPORT_ACTION = "EXPORT";
/** Exports per user in the window. Counted from the audit log, so it needs no extra table or Redis. */
export const EXPORT_LIMIT = { max: 5, windowMs: 10 * 60_000 } as const;

/**
 * Throws 429 once the user has made EXPORT_LIMIT.max exports in the window. Not atomic: two requests
 * arriving together can both pass, which is fine for a limit this small. A database error propagates
 * (the request fails), so the limit fails closed.
 */
export async function enforceExportLimit(user: SessionUser) {
  const used = await db.auditLog.count({
    where: { actorId: user.id, action: EXPORT_ACTION, createdAt: { gte: new Date(Date.now() - EXPORT_LIMIT.windowMs) } },
  });
  if (used >= EXPORT_LIMIT.max) {
    throw new ApiError(429, "Too many exports. Wait a few minutes and try again.", "RATE_LIMITED");
  }
}

/**
 * Writes the audit entry for an export. Unlike `audit()` this throws when the write fails: no record,
 * no data leaves. Called before the first byte is streamed.
 */
export async function recordExport(
  req: Request,
  user: SessionUser,
  entry: { entity: string; format: string; rows: number; filters: Record<string, unknown>; summary?: string },
) {
  // We write the entry ourselves, so authed() must not add its generic one for a POST.
  markAudited(req);
  let ip: string | undefined;
  try {
    ip = clientIp(await headers());
  } catch {
    // Outside a request scope: no IP.
  }
  await db.auditLog.create({
    data: {
      actorId: user.id,
      actorEmail: user.email ?? null,
      action: EXPORT_ACTION,
      entity: entry.entity,
      summary:
        entry.summary ?? `Exported ${entry.rows} ${entry.entity} row${entry.rows === 1 ? "" : "s"} as ${entry.format.toUpperCase()}`,
      data: JSON.parse(JSON.stringify({ format: entry.format, rows: entry.rows, filters: entry.filters })),
      ip,
    },
  });
}
