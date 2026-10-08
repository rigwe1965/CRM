import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { authed } from "@/lib/route";
import { audit } from "@/lib/audit";
import { sendInvite } from "@/lib/invite";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Admin-only: (re)issues the set-password link for a user, e.g. when the first invite was lost. */
export const POST = authed<{ id: string }>(async ({ req, user: admin, params }) => {
  await enforceRateLimit(`invite:${admin.id}`, LIMITS.sendEmail);
  const user = await db.user.findUnique({ where: { id: params.id }, select: { name: true, email: true, isActive: true } });
  if (!user) throw new ApiError(404, "User not found");
  if (!user.isActive) throw new ApiError(400, "Reactivate this user before sending an invite");
  await audit(admin, { action: "user.invite.sent", entity: "user", entityId: params.id, summary: user.email }, req);
  return NextResponse.json(await sendInvite(user.name ?? user.email, user.email));
}, "ADMIN");
