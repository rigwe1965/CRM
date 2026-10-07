import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { apiError } from "@/lib/api";
import { requireApiUser } from "@/lib/auth-helpers";
import { audit } from "@/lib/audit";
import { sendInvite } from "@/lib/invite";

export const dynamic = "force-dynamic";

/** Admin-only: (re)issues the set-password link for a user, e.g. when the first invite was lost. */
export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const guard = await requireApiUser("ADMIN");
  if (!guard.ok) return guard.response;
  const user = await db.user.findUnique({ where: { id: params.id }, select: { name: true, email: true, isActive: true } });
  if (!user) return apiError("User not found", 404);
  if (!user.isActive) return apiError("Reactivate this user before sending an invite", 400);
  await audit(guard.user, { action: "user.invite.sent", entity: "user", entityId: params.id, summary: user.email });
  return NextResponse.json(await sendInvite(user.name ?? user.email, user.email));
}
