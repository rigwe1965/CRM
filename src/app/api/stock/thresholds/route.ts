import { db } from "@/lib/db";
import { ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { tenantScope } from "@/lib/access";
import { stockKey } from "@/lib/stock";
import { setStockLevelSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

/**
 * PUT /api/stock/thresholds (admins): set when one stock row counts as low. Body: { product, color, lengthInches, threshold }.
 * `threshold` is the most pieces that still count as low; null falls back to the business default and 0 never alerts
 * for this row. The row is named by product, colour and length, matched case-insensitively like the stock table.
 */
export const PUT = authed(async ({ req, user }) => {
  const body = await readBody(req, setStockLevelSchema);
  const key = stockKey(body.product, body.color, body.lengthInches);
  const lengthInches = body.lengthInches ?? null;
  const saved = await db.stockThreshold.upsert({
    where: { tenantId_key: { tenantId: tenantScope(user).tenantId, key } },
    create: { ...tenantScope(user), key, product: body.product, color: body.color, lengthInches, threshold: body.threshold },
    update: { product: body.product, color: body.color, lengthInches, threshold: body.threshold },
    select: { key: true, threshold: true },
  });
  return ok(saved);
}, "ADMIN");
