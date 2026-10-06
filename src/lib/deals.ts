import type { DealStage, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { addMoney, sumMoney, type MoneyMap } from "@/lib/money";

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
export function dealDto<T extends { amount: Prisma.Decimal; items?: { unitPrice: Prisma.Decimal }[] }>(deal: T) {
  return {
    ...deal,
    amount: Number(deal.amount),
    items: deal.items?.map((i) => ({ ...i, unitPrice: Number(i.unitPrice) })),
  };
}

type ItemInput = { quantity: number; unitPrice: number };

/** A deal with line items is worth the sum of its lines. */
export const itemsTotal = (items: ItemInput[]) =>
  Math.round(items.reduce((s, i) => s + i.quantity * i.unitPrice, 0) * 100) / 100;

/** The single-line hair fields on Deal are superseded once line items are used. */
export const NO_LEGACY_HAIR = {
  productType: null,
  texture: null,
  lengthInches: null,
  color: null,
  laceType: null,
  quantity: null,
} as const;

/**
 * Per-stage counts, total value and probability-weighted value for the given (already scoped) deals.
 * Values are per currency (see MoneyMap): different currencies are never added together.
 */
export async function pipelineSummary(where: Prisma.DealWhereInput) {
  const rows = await db.deal.groupBy({
    by: ["stage", "probability", "currency"],
    where: { AND: [{ deletedAt: null }, where] },
    _count: { _all: true },
    _sum: { amount: true },
  });

  const stages = STAGES.map((stage) => {
    const mine = rows.filter((r) => r.stage === stage);
    const amount: MoneyMap = {};
    const weightedAmount: MoneyMap = {};
    for (const r of mine) {
      const sum = Number(r._sum.amount ?? 0);
      addMoney(amount, r.currency, sum);
      addMoney(weightedAmount, r.currency, (sum * r.probability) / 100);
    }
    return { stage, count: mine.reduce((n, r) => n + r._count._all, 0), amount, weightedAmount };
  });

  const open = stages.filter((s) => !isClosed(s.stage));
  return {
    stages,
    openCount: open.reduce((s, x) => s + x.count, 0),
    openAmount: sumMoney(open.map((s) => s.amount)),
    openWeightedAmount: sumMoney(open.map((s) => s.weightedAmount)),
  };
}

