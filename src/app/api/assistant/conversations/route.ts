import { ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { listConversations } from "@/lib/ai/conversations";

export const dynamic = "force-dynamic";

/** GET /api/assistant/conversations: your own 30 most recent chats with AI (nobody else's, admins included). */
export const GET = authed(async ({ user }) => ok(await listConversations(user)));
