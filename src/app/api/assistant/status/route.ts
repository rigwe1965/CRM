import { ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { assistantStatus } from "@/lib/ai/status";

export const dynamic = "force-dynamic";

/**
 * GET /api/assistant/status: can this business use Ivy right now, and if not, why (a code the panel turns into words).
 * For every signed-in user, so it holds no spending figures and no settings: those are admin-only (/api/admin/assistant).
 */
export const GET = authed(async ({ user }) => {
  const s = await assistantStatus(user.tenantId);
  const reason = !s.enabled ? "AI_DISABLED" : !s.keyConfigured ? "AI_NOT_CONFIGURED" : s.level === "unset" ? "AI_CEILING_UNSET" : s.level === "reached" ? "AI_CEILING_REACHED" : null;
  return ok({ ready: reason === null, documents: reason === null && s.documentsEnabled === true, orders: reason === null && s.documentsEnabled === true && s.proposalsEnabled === true, payments: reason === null && s.documentsEnabled === true && s.proposalsEnabled === true && s.paymentProposalsEnabled === true, reason, resetsOn: reason === "AI_CEILING_REACHED" ? s.resetsOn : null });
});
