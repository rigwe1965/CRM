import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { apiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth-helpers";
import { revokeCutoff } from "@/lib/sessions";
import { invalidateUserCache } from "@/lib/user-cache";

export const dynamic = "force-dynamic";

/** POST /api/admin/users/:id/mfa-reset: switch off a user's two-step verification (lost phone) and end their sessions. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApiUser("ADMIN");
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const { count } = await db.user.updateMany({
    where: { id },
    data: { mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null, mfaRecoveryCodes: [], passwordChangedAt: revokeCutoff() },
  });
  if (count === 0) return apiError("User not found", 404);
  invalidateUserCache(id);
  await audit(guard.user, { action: "mfa.reset", entity: "user", entityId: id, summary: "by admin" });
  return NextResponse.json({ ok: true });
}
