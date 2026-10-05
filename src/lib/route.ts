import type { Role } from "@prisma/client";
import { requireApiUser, type SessionUser } from "@/lib/auth-helpers";
import { toErrorResponse } from "@/lib/api";

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
  return async (req: Request, context: { params: P }): Promise<Response> => {
    try {
      const guard = await requireApiUser(...roles);
      if (!guard.ok) return guard.response;
      return await handler({ req, user: guard.user, params: context.params });
    } catch (e) {
      return toErrorResponse(e);
    }
  };
}
