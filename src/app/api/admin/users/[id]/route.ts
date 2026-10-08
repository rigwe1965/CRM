import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError, readBody } from "@/lib/api";
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
    const user = await db.user.update({
      where: { id: params.id },
      data,
      select: { id: true, email: true, name: true, role: true, isActive: true },
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
