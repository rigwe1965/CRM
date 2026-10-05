import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { apiError, parseBody } from "@/lib/api";
import { requireApiUser } from "@/lib/auth-helpers";
import { adminUpdateUserSchema } from "@/lib/validations/auth";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireApiUser("ADMIN");
  if (!guard.ok) return guard.response;
  const body = await parseBody(req, adminUpdateUserSchema);
  if ("response" in body) return body.response;

  // Guarantees at least one active admin always remains: you can't demote or deactivate yourself.
  const demoting = body.data.role !== undefined && body.data.role !== "ADMIN";
  const deactivating = body.data.isActive === false;
  if (params.id === guard.user.id && (demoting || deactivating)) {
    return apiError("You can't demote or deactivate your own account", 400);
  }

  try {
    const user = await db.user.update({
      where: { id: params.id },
      data: body.data,
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });
    return NextResponse.json({ user });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return apiError("User not found", 404);
    }
    throw e;
  }
}
