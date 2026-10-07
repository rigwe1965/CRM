import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth-helpers";
import { revokeCutoff } from "@/lib/sessions";
import { invalidateUserCache } from "@/lib/user-cache";

export const dynamic = "force-dynamic";

/** DELETE /api/me/sessions: sign out everywhere (every session issued before now stops working, including this one). */
export async function DELETE() {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;
  await db.user.update({ where: { id: guard.user.id }, data: { passwordChangedAt: revokeCutoff() } });
  invalidateUserCache(guard.user.id);
  await audit(guard.user, { action: "auth.sessions.revoked", entity: "user", entityId: guard.user.id });
  return NextResponse.json({ ok: true });
}
