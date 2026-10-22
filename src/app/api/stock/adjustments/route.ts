import { db } from "@/lib/db";
import { ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { resolveOwner, tenantScope } from "@/lib/access";
import { createStockAdjustmentSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

/** POST /api/stock/adjustments: record a signed correction (damaged, recount, opening stock...) for a stock row. */
export const POST = authed(async ({ req, user }) => {
  const body = await readBody(req, createStockAdjustmentSchema);
  const ownerId = (await resolveOwner(user, undefined))!;
  const adjustment = await db.stockAdjustment.create({
    data: { ...body, ...tenantScope(user), lengthInches: body.lengthInches ?? null, note: body.note ?? null, ownerId },
  });
  return ok(adjustment, 201);
});
