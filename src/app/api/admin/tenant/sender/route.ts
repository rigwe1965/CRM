import { z } from "zod";
import { ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { removeSender, senderView, setSender } from "@/lib/sender";

export const dynamic = "force-dynamic";

const schema = z.object({ domain: z.string().min(1).max(253), localPart: z.string().min(1).max(64) });

/** GET /api/admin/tenant/sender: the business's sending address, whether it is verified, and the DNS records still to publish. */
export const GET = authed(async ({ user }) => ok(await senderView(user.tenantId)), "ADMIN");

/** PUT /api/admin/tenant/sender { domain, localPart }: choose the address. A new domain must be verified before it is used. */
export const PUT = authed(async ({ req, user }) => {
  await setSender(user.tenantId, await readBody(req, schema));
  return ok(await senderView(user.tenantId));
}, "ADMIN");

/** DELETE /api/admin/tenant/sender: go back to the shared sender address. */
export const DELETE = authed(async ({ user }) => {
  await removeSender(user.tenantId);
  return ok(await senderView(user.tenantId));
}, "ADMIN");
