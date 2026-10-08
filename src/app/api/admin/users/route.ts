import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { ApiError, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { audit } from "@/lib/audit";
import { sendInvite } from "@/lib/invite";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { adminCreateUserSchema } from "@/lib/validations/auth";

export const dynamic = "force-dynamic";

/** Admin-only account creation (public sign-up is closed). The invitee sets their own password. */
export const POST = authed(async ({ req, user: admin }) => {
  const { name, email, role } = await readBody(req, adminCreateUserSchema);
  await enforceRateLimit(`invite:${admin.id}`, LIMITS.sendEmail);

  let user;
  try {
    user = await db.user.create({
      data: { name, email, role },
      select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new ApiError(409, "A user with this email already exists", "CONFLICT", { email: ["A user with this email already exists"] });
    }
    throw e;
  }
  await audit(admin, { action: "user.created", entity: "user", entityId: user.id, summary: email, data: { role } }, req);
  const { emailed, devLink } = await sendInvite(name, email);
  return NextResponse.json({ user, emailed, devLink }, { status: 201 });
}, "ADMIN");

export const GET = authed(async () => {
  const users = await db.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true, passwordHash: true, mfaEnabledAt: true },
  });
  // Never expose the hash itself, only whether the user has set a password yet.
  return NextResponse.json({
    users: users.map(({ passwordHash, mfaEnabledAt, ...u }) => ({ ...u, hasPassword: !!passwordHash, mfaEnabled: !!mfaEnabledAt })),
  });
}, "ADMIN");
