import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { apiError, parseBody } from "@/lib/api";
import { requireApiUser } from "@/lib/auth-helpers";
import { hashPassword, verifyPassword } from "@/lib/password";
import { audit } from "@/lib/audit";
import { invalidateUserCache } from "@/lib/user-cache";
import { changePasswordSchema } from "@/lib/validations/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;
  const body = await parseBody(req, changePasswordSchema);
  if ("response" in body) return body.response;
  const { currentPassword, newPassword } = body.data;

  const user = await db.user.findUnique({
    where: { id: guard.user.id },
    select: { passwordHash: true },
  });
  if (!user) return apiError("Unauthorized", 401);

  // Accounts created via magic link have no password yet, so they can set one without a current password.
  if (user.passwordHash) {
    if (!currentPassword || !(await verifyPassword(currentPassword, user.passwordHash))) {
      return apiError("Current password is incorrect", 400, {
        currentPassword: ["Current password is incorrect"],
      });
    }
  }

  // All existing sessions (including this one) are invalidated; the client signs out afterwards.
  await db.user.update({
    where: { id: guard.user.id },
    data: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date() },
  });
  invalidateUserCache(guard.user.id);
  await audit(guard.user, { action: "auth.password.changed", entity: "user", entityId: guard.user.id });
  return NextResponse.json({ ok: true });
}
