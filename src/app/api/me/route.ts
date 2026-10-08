import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { invalidateUserCache } from "@/lib/user-cache";
import { updateProfileSchema } from "@/lib/validations/auth";

export const dynamic = "force-dynamic";

const select = { id: true, email: true, name: true, role: true, createdAt: true, mfaEnabledAt: true } as const;

const dto = ({ mfaEnabledAt, ...u }: { id: string; email: string; name: string | null; role: string; createdAt: Date; mfaEnabledAt: Date | null }) => ({
  ...u,
  mfaEnabled: !!mfaEnabledAt,
});

export const GET = authed(async ({ user }) => {
  const me = await db.user.findUnique({ where: { id: user.id }, select });
  return NextResponse.json({ user: me && dto(me) });
});

export const PATCH = authed(async ({ req, user }) => {
  const body = await readBody(req, updateProfileSchema);
  const me = await db.user.update({ where: { id: user.id }, data: { name: body.name }, select });
  invalidateUserCache(me.id);
  return NextResponse.json({ user: dto(me) });
});
