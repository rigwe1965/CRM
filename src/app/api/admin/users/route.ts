import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { apiError, parseBody } from "@/lib/api";
import { requireApiUser } from "@/lib/auth-helpers";
import { sendInvite } from "@/lib/invite";
import { adminCreateUserSchema } from "@/lib/validations/auth";

export const dynamic = "force-dynamic";

/** Admin-only account creation (public sign-up is closed). The invitee sets their own password. */
export async function POST(req: Request) {
  const guard = await requireApiUser("ADMIN");
  if (!guard.ok) return guard.response;
  const body = await parseBody(req, adminCreateUserSchema);
  if ("response" in body) return body.response;
  const { name, email, role } = body.data;

  let user;
  try {
    user = await db.user.create({
      data: { name, email, role },
      select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return apiError("A user with this email already exists", 409, { email: ["A user with this email already exists"] });
    }
    throw e;
  }
  const { emailed, devLink } = await sendInvite(name, email);
  return NextResponse.json({ user, emailed, devLink }, { status: 201 });
}

export async function GET() {
  const guard = await requireApiUser("ADMIN");
  if (!guard.ok) return guard.response;

  const users = await db.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true, passwordHash: true },
  });
  // Never expose the hash itself, only whether the user has set a password yet.
  return NextResponse.json({ users: users.map(({ passwordHash, ...u }) => ({ ...u, hasPassword: !!passwordHash })) });
}
