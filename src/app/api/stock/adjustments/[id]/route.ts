import { db } from "@/lib/db";
import { noContent, ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { audit } from "@/lib/audit";
import { notFound, ownerScope } from "@/lib/access";
import { updateStockAdjustmentSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

type P = { id: string };

/** PATCH /api/stock/adjustments/:id: change the quantity, reason or note (not which stock row it belongs to). */
export const PATCH = authed<P>(async ({ req, user, params }) => {
  const body = await readBody(req, updateStockAdjustmentSchema);
  const before = await db.stockAdjustment.findFirst({ where: { id: params.id, ...ownerScope(user) } });
  const { count } = await db.stockAdjustment.updateMany({ where: { id: params.id, ...ownerScope(user) }, data: body });
  if (count === 0) throw notFound("Adjustment");
  await audit(user, { action: "stock.adjustment.updated", entity: "stockAdjustment", entityId: params.id, data: { before, changes: body } }, req);
  return ok(await db.stockAdjustment.findUniqueOrThrow({ where: { id: params.id } }));
});

/** DELETE /api/stock/adjustments/:id: permanent delete. */
export const DELETE = authed<P>(async ({ req, user, params }) => {
  const snapshot = await db.stockAdjustment.findFirst({ where: { id: params.id, ...ownerScope(user) } });
  const { count } = await db.stockAdjustment.deleteMany({ where: { id: params.id, ...ownerScope(user) } });
  if (count === 0) throw notFound("Adjustment");
  await audit(user, { action: "stock.adjustment.deleted", entity: "stockAdjustment", entityId: params.id, summary: snapshot?.product, data: snapshot }, req);
  return noContent();
});
