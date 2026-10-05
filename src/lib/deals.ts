import type { DealStage, Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/** Pipeline order, left to right. */
export const STAGES: readonly DealStage[] = [
  "QUALIFICATION",
  "DISCOVERY",
  "PROPOSAL",
  "NEGOTIATION",
  "CLOSED_WON",
  "CLOSED_LOST",
];

export const DEFAULT_PROBABILITY: Record<DealStage, number> = {
  QUALIFICATION: 10,
  DISCOVERY: 25,
  PROPOSAL: 50,
  NEGOTIATION: 75,
  CLOSED_WON: 100,
  CLOSED_LOST: 0,
};

export const isClosed = (stage: DealStage) => stage === "CLOSED_WON" || stage === "CLOSED_LOST";

/** Fields that must change together when a deal moves to a different stage. */
export function stageTransition(
  stage: DealStage,
  opts: { probability?: number; lostReason?: string | null } = {},
) {
  return {
    stage,
    probability: opts.probability ?? DEFAULT_PROBABILITY[stage],
    closedAt: isClosed(stage) ? new Date() : null,
    lostReason: stage === "CLOSED_LOST" ? (opts.lostReason ?? null) : null,
  };
}

/** Prisma Decimal → JSON number (amounts are Decimal(14,2), well inside double precision). */
export function dealDto<T extends { amount: Prisma.Decimal }>(deal: T) {
  return { ...deal, amount: Number(deal.amount) };
}

/** Per-stage counts, total value and probability-weighted value for the given (already scoped) deals. */
export async function pipelineSummary(where: Prisma.DealWhereInput) {
  const rows = await db.deal.groupBy({
    by: ["stage", "probability"],
    where: { AND: [{ deletedAt: null }, where] },
    _count: { _all: true },
    _sum: { amount: true },
  });

  const stages = STAGES.map((stage) => {
    const mine = rows.filter((r) => r.stage === stage);
    const amount = mine.reduce((sum, r) => sum + Number(r._sum.amount ?? 0), 0);
    const weighted = mine.reduce((sum, r) => sum + (Number(r._sum.amount ?? 0) * r.probability) / 100, 0);
    return {
      stage,
      count: mine.reduce((sum, r) => sum + r._count._all, 0),
      amount: round2(amount),
      weightedAmount: round2(weighted),
    };
  });

  const open = stages.filter((s) => !isClosed(s.stage));
  return {
    stages,
    openCount: open.reduce((s, x) => s + x.count, 0),
    openAmount: round2(open.reduce((s, x) => s + x.amount, 0)),
    openWeightedAmount: round2(open.reduce((s, x) => s + x.weightedAmount, 0)),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
