import type { Role } from "@prisma/client";
import { requireApiUser, type SessionUser } from "@/lib/auth-helpers";
import { toErrorResponse } from "@/lib/api";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { audit, wasAudited } from "@/lib/audit";

type Ctx<P> = { req: Request; user: SessionUser; params: P };

/**
 * Wraps a route handler with authentication, optional role restriction (ADMIN always passes)
 * and uniform error handling. Throw `ApiError` (or let Zod/Prisma errors bubble) inside.
 *
 *   export const GET = authed(async ({ req, user, params }) => ok(...));
 *   export const POST = authed(handler, "ADMIN");
 */
export function authed<P = Record<string, string>>(
  handler: (ctx: Ctx<P>) => Promise<Response>,
  ...roles: Role[]
) {
  // Next 15 passes route params as a Promise.
  return async (req: Request, context: { params: Promise<P> }): Promise<Response> => {
    try {
      const guard = await requireApiUser(...roles);
      if (!guard.ok) return guard.response;
      const write = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      await enforceRateLimit(`api:${write ? "w" : "r"}:${guard.user.id}`, write ? LIMITS.apiWrite : LIMITS.apiRead);
      // Routes without a URL segment get no params object at all in Next 15.
      const params = (await context?.params) ?? ({} as P);
      const res = await handler({ req, user: guard.user, params });
      // Every successful write is logged; handlers that call audit() themselves (e.g. to keep a
      // snapshot of what was deleted) replace this generic entry.
      if (res.status < 400 && write && !wasAudited(req)) {
        const path = new URL(req.url).pathname;
        await audit(guard.user, {
          action: `${req.method} ${path}`,
          entity: path.split("/")[2],
          entityId: Object.values(params as Record<string, string>)[0],
        });
      }
      return res;
    } catch (e) {
      return toErrorResponse(e);
    }
  };
}
