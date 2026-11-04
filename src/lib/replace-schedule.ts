import type { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import type { SessionUser } from "@/lib/auth-helpers";
import { notFound, ownerScope, tenantScope } from "@/lib/access";
import { audit } from "@/lib/audit";
import { dealPaymentsView } from "@/lib/payments";
import type { scheduleSchema } from "@/lib/validations/crm";

/** A schedule reduced to a comparable string, so a card can tell whether the one it was made against is still there. */
export const scheduleKey = (rows: { dueDate: Date; amount: unknown }[]) =>
  [...rows].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime()).map((r) => `${r.dueDate.toISOString().slice(0, 10)}:${Number(r.amount).toFixed(2)}`).join("|");

/**
 * Replaces a deal's instalment schedule (an empty list clears it). The one place this write lives: the deal's schedule
 * route and an approved AI proposal (AI_ASSISTANT_PLAN.md, Phase 3a) both call it. The total may not exceed the deal
 * amount. `expect` (an approved proposal passes it) is what the schedule and the amount paid were when the card was
 * made: if either differs once the deal is locked, nothing changes. Writes the `schedule.replaced` audit entry with the
 * before and after. Run inside the business's context.
 */
export async function replaceSchedule(
  user: SessionUser,
  dealId: string,
  instalments: z.infer<typeof scheduleSchema>["instalments"],
  opts: { req?: Request; expect?: { paid: number; scheduleKey: string } } = {},
) {
  const deal = await db.deal.findFirst({
    where: { id: dealId, deletedAt: null, ...ownerScope(user) },
    select: { id: true, amount: true, currency: true },
  });
  if (!deal) throw notFound("Deal");

  const total = Math.round(instalments.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  if (total > Number(deal.amount)) {
    const msg = `Instalments total ${total.toFixed(2)}, more than the deal amount of ${Number(deal.amount).toFixed(2)} ${deal.currency}`;
    throw new ApiError(422, msg, "VALIDATION_ERROR", { instalments: [msg] });
  }

  const before = await db.$transaction(async (tx) => {
    // The same row lock a payment takes, so a payment and a schedule change cannot interleave.
    await tx.$queryRaw`SELECT id FROM "Deal" WHERE id = ${deal.id} AND "tenantId" = ${user.tenantId} FOR UPDATE`;
    const current = await tx.instalment.findMany({ where: { dealId: deal.id, ...tenantScope(user) }, orderBy: { position: "asc" } });
    if (opts.expect) {
      const { _sum } = await tx.payment.aggregate({ where: { dealId: deal.id, ...tenantScope(user) }, _sum: { amount: true } });
      const paid = Number(_sum.amount ?? 0);
      if (Math.abs(paid - opts.expect.paid) > 0.004 || scheduleKey(current) !== opts.expect.scheduleKey) {
        throw new ApiError(409, "The payments or the schedule on this deal changed after AI suggested this, so nothing was changed. Look at the deal and ask again if needed.", "AI_PROPOSAL_STALE");
      }
    }
    await tx.instalment.deleteMany({ where: { dealId: deal.id, ...tenantScope(user) } });
    await tx.instalment.createMany({
      data: instalments.map((i, n) => ({ tenantId: user.tenantId, dealId: deal.id, position: n + 1, dueDate: i.dueDate, amount: i.amount })),
    });
    return current;
  });
  await audit(user, { action: "schedule.replaced", entity: "deal", entityId: deal.id, data: { before, after: instalments } }, opts.req);
  return dealPaymentsView(deal);
}
