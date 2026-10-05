import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireApiUser } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireApiUser("ADMIN");
  if (!guard.ok) return guard.response;

  const users = await db.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
  });
  return NextResponse.json({ users });
}
