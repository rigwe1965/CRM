import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseBody } from "@/lib/api";
import { requireApiUser } from "@/lib/auth-helpers";
import { invalidateUserCache } from "@/lib/user-cache";
import { updateProfileSchema } from "@/lib/validations/auth";

export const dynamic = "force-dynamic";

const select = { id: true, email: true, name: true, role: true, createdAt: true, mfaEnabledAt: true } as const;

const dto = ({ mfaEnabledAt, ...u }: { id: string; email: string; name: string | null; role: string; createdAt: Date; mfaEnabledAt: Date | null }) => ({
  ...u,
  mfaEnabled: !!mfaEnabledAt,
});

export async function GET() {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;
  const user = await db.user.findUnique({ where: { id: guard.user.id }, select });
  return NextResponse.json({ user: user && dto(user) });
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
  invalidateUserCache(user.id);
  return NextResponse.json({ user: dto(user) });
}
