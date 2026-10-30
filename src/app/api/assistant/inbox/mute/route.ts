import { z } from "zod";
import { ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const body = z.object({ muted: z.boolean() });

/** PUT /api/assistant/inbox/mute { muted }: turns the daily suggestions off or on for the signed-in person only. */
export const PUT = authed(async ({ req, user }) => {
  const { muted } = await readBody(req, body);
  await db.user.updateMany({ where: { id: user.id, tenantId: user.tenantId }, data: { aiSuggestionsMuted: muted } });
  return ok({ muted });
});
