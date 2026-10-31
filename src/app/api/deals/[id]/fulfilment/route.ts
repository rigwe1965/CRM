import { ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { updateFulfilment } from "@/lib/fulfilment-update";
import { dealFulfilmentSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

/**
 * POST /api/deals/:id/fulfilment { status?, carrier?, trackingNumber? }: moves a won order along its shipping steps
 * (NOT_STARTED, PACKED, SHIPPED, DELIVERED, RETURNED) and/or records the carrier and tracking number. Returns the deal.
 */
export const POST = authed<{ id: string }>(async ({ req, user, params }) => {
  const body = await readBody(req, dealFulfilmentSchema);
  return ok(await updateFulfilment(user, params.id, body));
});
