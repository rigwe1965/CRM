import { z } from "zod";
import { ApiError, ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { audit } from "@/lib/audit";
import { approveProposal } from "@/lib/ai/proposals";

export const dynamic = "force-dynamic";

const body = z.object({ edits: z.record(z.string(), z.unknown()).optional() });

/**
 * POST /api/assistant/proposals/:id/approve { edits? }: the person says yes. Runs the proposed action as them, through the
 * same code as the screen, once. `edits` are changes they made on the card; only the fields that card offers are accepted
 * and everything is validated again. If the record changed since Ivy suggested it, nothing is done and the answer says why
 * (status FAILED). Not available in a read-only workspace, which can read and export but not change anything.
 */
export const POST = authed<{ id: string }>(async ({ req, user, params }) => {
  const { edits } = await readBody(req, body);
  if (user.tenantWritable === false) {
    throw new ApiError(403, "This workspace is read-only until its subscription is renewed, so this cannot be applied.", "READ_ONLY");
  }
  const proposal = await approveProposal(user, params.id, edits);
  const what = [proposal.preview.title, proposal.preview.lines[0] && `${proposal.preview.lines[0].label}: ${proposal.preview.lines[0].value}`].filter(Boolean).join(" · ");
  await audit(user, { action: "assistant.proposal.approve", entity: "ai_proposal", entityId: proposal.id, summary: `Approved Ivy's proposal (${what}): ${proposal.status.toLowerCase()}` }, req);
  return ok(proposal);
});
