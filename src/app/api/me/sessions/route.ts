import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authed } from "@/lib/route";
import { audit } from "@/lib/audit";
import { revokeCutoff } from "@/lib/sessions";
import { invalidateUserCache } from "@/lib/user-cache";

export const dynamic = "force-dynamic";

/** DELETE /api/me/sessions: sign out everywhere (every session issued before now stops working, including this one). */
export const DELETE = authed(async ({ req, user }) => {
  await db.user.update({ where: { id: user.id }, data: { passwordChangedAt: revokeCutoff() } });
  invalidateUserCache(user.id);
  await audit(user, { action: "auth.sessions.revoked", entity: "user", entityId: user.id }, req);
  return NextResponse.json({ ok: true });
});
