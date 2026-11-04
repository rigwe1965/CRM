import { ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { inboxAvailability, runToday } from "@/lib/ai/inbox/run";
import { listInbox } from "@/lib/ai/proposals";

export const dynamic = "force-dynamic";

/**
 * GET /api/assistant/inbox: this person's "Suggested actions": what AI suggested on its own and is waiting for a
 * decision, plus what they decided in the last day. `available` says whether the inbox is on for them (an admin switch,
 * a mute, a read-only workspace); `ranToday` and `running` let the panel know whether to ask for today's suggestions.
 * Their own cards only: nobody, admins included, sees another person's.
 */
export const GET = authed(async ({ user }) => {
  const available = await inboxAvailability(user);
  if (available === "disabled") return ok({ available, ranToday: false, running: false, pending: 0, items: [] });
  const [run, items] = await Promise.all([runToday(user), listInbox(user)]);
  return ok({ available, ranToday: !!run && run.status !== "FAILED", running: run?.status === "RUNNING", pending: items.filter((i) => i.status === "PENDING").length, items });
});
