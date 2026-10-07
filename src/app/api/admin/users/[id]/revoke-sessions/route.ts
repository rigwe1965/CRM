import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { apiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth-helpers";
import { revokeCutoff } from "@/lib/sessions";
import { invalidateUserCache } from "@/lib/user-cache";

export const dynamic = "force-dynamic";

/** POST /api/admin/users/:id/revoke-sessions: admin signs a user out everywhere (lost laptop, leaver). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApiUser("ADMIN");
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const { count } = await db.user.updateMany({ where: { id }, data: { passwordChangedAt: revokeCutoff() } });
  if (count === 0) return apiError("User not found", 404);
  invalidateUserCache(id);
  await audit(guard.user, { action: "auth.sessions.revoked", entity: "user", entityId: id, summary: "by admin" });
  return NextResponse.json({ ok: true });
}
