import { ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { replaceSchedule } from "@/lib/replace-schedule";
import { scheduleSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

/** PUT /api/deals/:id/schedule: replace the instalment schedule (send an empty list to clear it). */
export const PUT = authed<{ id: string }>(async ({ req, user, params }) => {
  const { instalments } = await readBody(req, scheduleSchema);
  return ok(await replaceSchedule(user, params.id, instalments, { req }));
});
