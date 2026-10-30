import { after } from "next/server";
import { ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { keepTenant } from "@/lib/tenant-context";
import { inboxAvailability, runInboxForUser, runToday } from "@/lib/ai/inbox/run";

export const dynamic = "force-dynamic";
// The run happens after this answers, inside the host's function limit.
export const maxDuration = 60;

/**
 * POST /api/assistant/inbox/refresh: asks for today's suggestions. Answers at once; the work runs after the response and
 * happens once per person per day, however often this is called. The panel calls it the first time someone uses the app
 * each day, then reads GET /api/assistant/inbox until the cards appear.
 */
export const POST = authed(async ({ user }) => {
  const available = await inboxAvailability(user);
  if (available !== "ok") return ok({ status: available });
  const existing = await runToday(user);
  if (existing && existing.status !== "FAILED" && !(existing.status === "RUNNING" && Date.now() - existing.startedAt.getTime() > 10 * 60_000)) {
    return ok({ status: existing.status === "DONE" ? "already" : "running" });
  }
  const inBusiness = keepTenant();
  after(() => inBusiness(() => runInboxForUser(user)).then(() => undefined, (e) => console.error("[ivy-inbox] background run failed", e instanceof Error ? e.message : e)));
  return ok({ status: "started" });
});
