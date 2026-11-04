import { ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { audit } from "@/lib/audit";
import { declineProposal } from "@/lib/ai/proposals";

export const dynamic = "force-dynamic";

/** POST /api/assistant/proposals/:id/decline: the person says no (or dismisses a draft). Nothing is done. Works in a read-only workspace. */
export const POST = authed<{ id: string }>(async ({ req, user, params }) => {
  const proposal = await declineProposal(user, params.id);
  await audit(user, { action: "assistant.proposal.decline", entity: "ai_proposal", entityId: proposal.id, summary: `Declined AI's proposal (${proposal.preview.title})` }, req);
  return ok(proposal);
});
