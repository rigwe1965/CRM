import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { authed } from "@/lib/route";
import { audit } from "@/lib/audit";
import { revokeCutoff } from "@/lib/sessions";
import { invalidateUserCache } from "@/lib/user-cache";

export const dynamic = "force-dynamic";

/** POST /api/admin/users/:id/revoke-sessions: admin signs a user out everywhere (lost laptop, leaver). */
export const POST = authed<{ id: string }>(async ({ req, user: admin, params }) => {
  const { id } = params;
  const { count } = await db.user.updateMany({ where: { id }, data: { passwordChangedAt: revokeCutoff() } });
  if (count === 0) throw new ApiError(404, "User not found");
  invalidateUserCache(id);
  await audit(admin, { action: "auth.sessions.revoked", entity: "user", entityId: id, summary: "by admin" }, req);
  return NextResponse.json({ ok: true });
}, "ADMIN");
