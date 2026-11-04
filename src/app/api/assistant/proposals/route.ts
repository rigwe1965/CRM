import { z } from "zod";
import { ok, readQuery } from "@/lib/api";
import { authed } from "@/lib/route";
import { listProposals } from "@/lib/ai/proposals";

export const dynamic = "force-dynamic";

const query = z.object({ conversationId: z.string().trim().min(1).max(40) });

/** GET /api/assistant/proposals?conversationId=: the cards AI has put in one of your chats, oldest first. Yours only. */
export const GET = authed(async ({ req, user }) => {
  const { conversationId } = readQuery(req, query);
  return ok(await listProposals(user, conversationId));
});
