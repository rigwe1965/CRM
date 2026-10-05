import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseBody } from "@/lib/api";
import { requireApiUser } from "@/lib/auth-helpers";
import { updateProfileSchema } from "@/lib/validations/auth";

const select = { id: true, email: true, name: true, role: true, createdAt: true } as const;

export async function GET() {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;
  const user = await db.user.findUnique({ where: { id: guard.user.id }, select });
  return NextResponse.json({ user });
}

export async function PATCH(req: Request) {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;
  const body = await parseBody(req, updateProfileSchema);
  if ("response" in body) return body.response;

  const user = await db.user.update({
    where: { id: guard.user.id },
    data: { name: body.data.name },
    select,
  });
  return NextResponse.json({ user });
}
