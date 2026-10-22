import { db } from "@/lib/db";
import { ApiError, noContent } from "@/lib/api";
import { authed } from "@/lib/route";
import { tenantScope } from "@/lib/access";

export const dynamic = "force-dynamic";

/** DELETE /api/saved-filters/:id: remove one of your own saved views. Someone else's id is a plain 404. */
export const DELETE = authed<{ id: string }>(async ({ user, params }) => {
  const { count } = await db.savedFilter.deleteMany({ where: { id: params.id, userId: user.id, ...tenantScope(user) } });
  if (count === 0) throw new ApiError(404, "Saved view not found", "NOT_FOUND");
  return noContent();
});
