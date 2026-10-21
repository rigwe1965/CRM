import { db } from "@/lib/db";
import { ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { ApiError } from "@/lib/api";
import { allowedOrigins, loadLeadFormOwnerId, resolveLeadOwner, saveLeadFormOwnerId } from "@/lib/web-lead";
import { leadFormSettingsSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

async function view() {
  const [ownerId, effective, users] = await Promise.all([
    loadLeadFormOwnerId(),
    resolveLeadOwner(),
    db.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
  ]);
  return { ownerId, effectiveOwner: effective ? { id: effective.id, name: effective.name, email: effective.email } : null, users, allowedOrigins: allowedOrigins() };
}

/** GET /api/admin/lead-form: who website leads are assigned to, the people to choose from, and the websites allowed to post. */
export const GET = authed(async () => ok(await view()), "ADMIN");

/** PUT /api/admin/lead-form { ownerId }: choose who gets website leads (null = the first admin). */
export const PUT = authed(async ({ req, user }) => {
  const { ownerId } = await readBody(req, leadFormSettingsSchema);
  if (ownerId && !(await db.user.findFirst({ where: { id: ownerId, isActive: true }, select: { id: true } }))) {
    throw new ApiError(422, "Choose an active team member", "VALIDATION_ERROR", { ownerId: ["Choose an active team member"] });
  }
  await saveLeadFormOwnerId(ownerId, user.id);
  return ok(await view());
}, "ADMIN");
