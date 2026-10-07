import { db } from "@/lib/db";
import { ApiError, ok, readBody } from "@/lib/api";
import { authed } from "@/lib/route";
import { audit } from "@/lib/audit";
import { notFound, ownerScope } from "@/lib/access";
import { dealPaymentsView } from "@/lib/payments";
import { scheduleSchema } from "@/lib/validations/crm";

export const dynamic = "force-dynamic";

/** PUT /api/deals/:id/schedule: replace the instalment schedule (send an empty list to clear it). */
export const PUT = authed<{ id: string }>(async ({ req, user, params }) => {
  const { instalments } = await readBody(req, scheduleSchema);
  const deal = await db.deal.findFirst({
    where: { id: params.id, deletedAt: null, ...ownerScope(user) },
    select: { id: true, amount: true, currency: true },
  });
  if (!deal) throw notFound("Deal");

  const total = Math.round(instalments.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  if (total > Number(deal.amount)) {
    const msg = `Instalments total ${total.toFixed(2)}, more than the deal amount of ${Number(deal.amount).toFixed(2)} ${deal.currency}`;
    throw new ApiError(422, msg, "VALIDATION_ERROR", { instalments: [msg] });
  }

  const before = await db.instalment.findMany({ where: { dealId: deal.id }, orderBy: { position: "asc" } });
  await db.$transaction([
    db.instalment.deleteMany({ where: { dealId: deal.id } }),
    db.instalment.createMany({
      data: instalments.map((i, n) => ({ dealId: deal.id, position: n + 1, dueDate: i.dueDate, amount: i.amount })),
    }),
  ]);
  await audit(user, { action: "schedule.replaced", entity: "deal", entityId: deal.id, data: { before, after: instalments } }, req);
  return ok(await dealPaymentsView(deal));
});
