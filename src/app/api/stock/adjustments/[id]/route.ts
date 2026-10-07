import { db } from "@/lib/db";
import { noContent, ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { notFound, ownerScope } from "@/lib/access";
import { updateStockAdjustmentSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

type P = { id: string };

/** PATCH /api/stock/adjustments/:id: change the quantity, reason or note (not which stock row it belongs to). */
export const PATCH = authed<P>(async ({ req, user, params }) => {
  const body = await readBody(req, updateStockAdjustmentSchema);
  const { count } = await db.stockAdjustment.updateMany({ where: { id: params.id, ...ownerScope(user) }, data: body });
  if (count === 0) throw notFound("Adjustment");
  return ok(await db.stockAdjustment.findUniqueOrThrow({ where: { id: params.id } }));
});

/** DELETE /api/stock/adjustments/:id: permanent delete. */
export const DELETE = authed<P>(async ({ user, params }) => {
  const { count } = await db.stockAdjustment.deleteMany({ where: { id: params.id, ...ownerScope(user) } });
  if (count === 0) throw notFound("Adjustment");
  return noContent();
});
