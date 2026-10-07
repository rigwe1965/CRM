import { headers } from "next/headers";
import { db } from "@/lib/db";
import { clientIp } from "@/lib/rate-limit";

/**
 * Append-only audit trail (AuditLog table). `authed()` records every successful write automatically;
 * call `audit()` yourself for sign-in and account events, and to attach a snapshot to a delete.
 * It never throws: a logging failure must not undo or block the action it describes.
 */
type Actor = { id?: string | null; email?: string | null } | null;
export type AuditEntry = { action: string; entity?: string; entityId?: string; summary?: string; data?: unknown };

const audited = new WeakSet<Request>();
/** True when `audit()` was already called for this request (so `authed()` skips its generic entry). */
export const wasAudited = (req: Request) => audited.has(req);

const toJson = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export async function audit(actor: Actor, entry: AuditEntry, req?: Request) {
  if (req) audited.add(req);
  try {
    let ip: string | undefined;
    try {
      ip = clientIp(await headers());
    } catch {
      // Outside a request scope (scripts): no IP.
    }
    await db.auditLog.create({
      data: {
        actorId: actor?.id ?? null,
        actorEmail: actor?.email ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        summary: entry.summary,
        data: toJson(entry.data),
        ip,
      },
    });
  } catch (e) {
    console.error("[audit] failed to write", entry.action, e instanceof Error ? e.message : e);
  }
}
