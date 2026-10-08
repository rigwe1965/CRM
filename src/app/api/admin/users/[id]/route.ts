import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError, readBody } from "@/lib/api";
import { wouldLeaveNoAdmin } from "@/lib/access";
import { authed } from "@/lib/route";
import { audit } from "@/lib/audit";
import { invalidateUserCache } from "@/lib/user-cache";
import { adminUpdateUserSchema } from "@/lib/validations/auth";

export const dynamic = "force-dynamic";

export const PATCH = authed<{ id: string }>(async ({ req, user: admin, params }) => {
  const data = await readBody(req, adminUpdateUserSchema);

  // Guarantees at least one active admin always remains: you can't demote or deactivate yourself.
  const demoting = data.role !== undefined && data.role !== "ADMIN";
  const deactivating = data.isActive === false;
  if (params.id === admin.id && (demoting || deactivating)) {
    throw new ApiError(400, "You can't demote or deactivate your own account");
  }

  try {
    const user = await db.$transaction(async (tx) => {
      if (demoting || deactivating) {
        // Lock every active admin so two admins demoting each other at the same moment are serialised
        // and the second one sees the first one's change.
        await tx.$queryRaw`SELECT id FROM "User" WHERE role = 'ADMIN' AND "isActive" = true FOR UPDATE`;
        const target = await tx.user.findUnique({ where: { id: params.id }, select: { role: true, isActive: true } });
        const otherActiveAdmins = await tx.user.count({ where: { role: "ADMIN", isActive: true, id: { not: params.id } } });
        if (target && wouldLeaveNoAdmin({ target, demoting, deactivating, otherActiveAdmins })) {
          throw new ApiError(400, "At least one active admin must remain");
        }
      }
      return tx.user.update({
        where: { id: params.id },
        data,
        select: { id: true, email: true, name: true, role: true, isActive: true },
      });
    });
    invalidateUserCache(user.id);
    await audit(admin, { action: "user.updated", entity: "user", entityId: user.id, summary: user.email, data }, req);
    return NextResponse.json({ user });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      throw new ApiError(404, "User not found");
    }
    throw e;
  }
}, "ADMIN");
