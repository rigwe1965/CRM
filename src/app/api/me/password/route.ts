import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { hashPassword, verifyPassword } from "@/lib/password";
import { audit } from "@/lib/audit";
import { invalidateUserCache } from "@/lib/user-cache";
import { changePasswordSchema } from "@/lib/validations/auth";

export const dynamic = "force-dynamic";

export const POST = authed(async ({ req, user: me }) => {
  const { currentPassword, newPassword } = await readBody(req, changePasswordSchema);

  const user = await db.user.findUnique({
    where: { id: me.id },
    select: { passwordHash: true },
  });
  if (!user) throw new ApiError(401, "Unauthorized");

  // Accounts created via magic link have no password yet, so they can set one without a current password.
  if (user.passwordHash) {
    if (!currentPassword || !(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new ApiError(400, "Current password is incorrect", "BAD_REQUEST", {
        currentPassword: ["Current password is incorrect"],
      });
    }
  }

  // All existing sessions (including this one) are invalidated; the client signs out afterwards.
  await db.user.update({
    where: { id: me.id },
    data: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date() },
  });
  invalidateUserCache(me.id);
  await audit(me, { action: "auth.password.changed", entity: "user", entityId: me.id }, req);
  return NextResponse.json({ ok: true });
});
