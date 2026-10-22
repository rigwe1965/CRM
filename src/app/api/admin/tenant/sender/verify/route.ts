import { ok } from "@/lib/api";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { authed } from "@/lib/route";
import { senderView, verifySender } from "@/lib/sender";

export const dynamic = "force-dynamic";

/** POST /api/admin/tenant/sender/verify: ask the email provider to check the DNS records now. */
export const POST = authed(async ({ user }) => {
  await enforceRateLimit(`sender-verify:${user.tenantId}`, LIMITS.sendEmail);
  await verifySender(user.tenantId);
  return ok(await senderView(user.tenantId));
}, "ADMIN");
