import { z } from "zod";
import { ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { cancelDeletion, deletionStatus, requestDeletion } from "@/lib/tenant-deletion";

export const dynamic = "force-dynamic";

const requestSchema = z.object({ confirmName: z.string().min(1).max(200), code: z.string().max(64).optional() });

/** GET /api/admin/tenant/deletion: whether the business is waiting to be erased, and when. */
export const GET = authed(async ({ user }) => ok(await deletionStatus(user.tenantId)), "ADMIN");

/** POST /api/admin/tenant/deletion { confirmName, code? }: start the grace period. The business turns read-only; export and cancelling still work. */
export const POST = authed(async ({ req, user }) => ok(await requestDeletion(user, await readBody(req, requestSchema), req)), "ADMIN");

/** DELETE /api/admin/tenant/deletion: change your mind before the erasure date. */
export const DELETE = authed(async ({ req, user }) => ok(await cancelDeletion(user, req)), "ADMIN");
