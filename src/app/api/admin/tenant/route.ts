import { z } from "zod";
import { db } from "@/lib/db";
import { ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";

export const dynamic = "force-dynamic";

const select = { id: true, name: true, brandName: true, senderName: true, plan: true } as const;

// One line, no control characters: these end up in email headers and subjects.
const line = z.string().trim().max(80).regex(/^[^\u0000-\u001f\u007f<>"]*$/, "No line breaks, quotes or angle brackets");

const updateSchema = z.object({
  name: line.min(1).optional(),
  brandName: line.nullable().optional(),
  senderName: line.nullable().optional(),
});

/** GET /api/admin/tenant: how the business presents itself. */
export const GET = authed(async ({ user }) => ok(await db.tenant.findFirstOrThrow({ where: { id: user.tenantId }, select })), "ADMIN");

/** PATCH /api/admin/tenant { name?, brandName?, senderName? }: the name customers see in the business's emails. Billing fields can't be set here. */
export const PATCH = authed(async ({ req, user }) => {
  const data = await readBody(req, updateSchema);
  return ok(await db.tenant.update({ where: { id: user.tenantId }, data: { ...(data.name && { name: data.name }), ...(data.brandName !== undefined && { brandName: data.brandName || null }), ...(data.senderName !== undefined && { senderName: data.senderName || null }) }, select }));
}, "ADMIN");
