import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { round2 } from "@/lib/money";
import { campaignAudienceSchema, type CampaignAudience } from "@/lib/validations/crm";

/** The most customers one campaign may reach. A bigger audience is refused when it is sent (phase 2); the preview says so. */
export const MAX_AUDIENCE = 2000;
/** How many candidates are examined when "paid in full" has to be worked out in code. */
const CANDIDATE_LIMIT = 20_000;
const SAMPLE = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AudiencePreview = {
  /** Customers the campaign would reach. */
  total: number;
  /** Customers matching the filters who cannot be messaged: they have not agreed to WhatsApp, or have no WhatsApp-ready number. */
  notReachable: number;
  tooLarge: boolean;
  max: number;
  sample: { id: string; name: string }[];
};

/** The stored filter read back safely: anything missing or invalid becomes "no restriction". */
export const readAudience = (raw: unknown): CampaignAudience => {
  const parsed = campaignAudienceSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : campaignAudienceSchema.parse({});
};

const chunks = <T>(list: T[], size = 1000) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

/** The contact filter without the opt-in rules, so the same filter can count both who is reachable and who is not. */
function filterWhere(tenantId: string, a: CampaignAudience, now: Date): Prisma.ContactWhereInput {
  return {
    tenantId,
    deletedAt: null,
    ...(a.tagIds.length && { tags: { some: { tenantId, tagId: { in: a.tagIds } } } }),
    ...(a.types.length && { type: { in: a.types } }),
    ...(a.leadStatuses.length && { leadStatus: { in: a.leadStatuses } }),
    ...(a.sources.length && { OR: a.sources.map((source) => ({ source: { equals: source, mode: "insensitive" as const } })) }),
    ...(a.noOrderDays && {
      deals: { none: { tenantId, deletedAt: null, stage: "CLOSED_WON" as const, createdAt: { gte: new Date(now.getTime() - a.noOrderDays * DAY_MS) } } },
    }),
  };
}

const reachable = (where: Prisma.ContactWhereInput): Prisma.ContactWhereInput => ({ ...where, whatsappOptIn: true, phoneE164: { not: null } });

/** Of these contacts, the ones with at least one won order and every won order paid in full. */
async function paidInFull(tenantId: string, contactIds: string[]): Promise<Set<string>> {
  const deals: { id: string; contactId: string | null; amount: number }[] = [];
  for (const part of chunks(contactIds)) {
    const rows = await db.deal.findMany({ where: { tenantId, deletedAt: null, stage: "CLOSED_WON", contactId: { in: part } }, select: { id: true, contactId: true, amount: true } });
    deals.push(...rows.map((d) => ({ ...d, amount: Number(d.amount) })));
  }
  const paid = new Map<string, number>();
  for (const part of chunks(deals.map((d) => d.id))) {
    const sums = await db.payment.groupBy({ by: ["dealId"], where: { tenantId, dealId: { in: part } }, _sum: { amount: true } });
    for (const s of sums) paid.set(s.dealId, Number(s._sum.amount ?? 0));
  }
  const owes = new Set<string>();
  const hasOrder = new Set<string>();
  for (const d of deals) {
    if (!d.contactId) continue;
    hasOrder.add(d.contactId);
    if (round2(d.amount - (paid.get(d.id) ?? 0)) > 0) owes.add(d.contactId);
  }
  return new Set([...hasOrder].filter((id) => !owes.has(id)));
}

/**
 * Works out who a campaign filter reaches, for one business (this is an admin tool, so it sees the whole business).
 * `ids` (the recipients, oldest contact first) is only returned when asked for, and never more than MAX_AUDIENCE + 1 of them,
 * enough to tell that the audience is too large.
 */
export async function audienceFor(tenantId: string, audience: CampaignAudience, opts: { ids?: boolean; now?: Date } = {}): Promise<AudiencePreview & { ids?: string[] }> {
  const where = filterWhere(tenantId, audience, opts.now ?? new Date());
  const [matching, can] = await Promise.all([db.contact.count({ where }), db.contact.count({ where: reachable(where) })]);
  const notReachable = matching - can;

  if (!audience.paidInFull) {
    const rows = await db.contact.findMany({
      where: reachable(where),
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: opts.ids ? MAX_AUDIENCE + 1 : SAMPLE,
    });
    return {
      total: can,
      notReachable,
      tooLarge: can > MAX_AUDIENCE,
      max: MAX_AUDIENCE,
      sample: rows.slice(0, SAMPLE).map((c) => ({ id: c.id, name: fullName(c) })),
      ...(opts.ids && { ids: rows.map((c) => c.id) }),
    };
  }

  const candidates = await db.contact.findMany({
    where: reachable(where),
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: CANDIDATE_LIMIT,
  });
  const ok = await paidInFull(tenantId, candidates.map((c) => c.id));
  const picked = candidates.filter((c) => ok.has(c.id));
  return {
    total: picked.length,
    notReachable,
    tooLarge: picked.length > MAX_AUDIENCE,
    max: MAX_AUDIENCE,
    sample: picked.slice(0, SAMPLE).map((c) => ({ id: c.id, name: fullName(c) })),
    ...(opts.ids && { ids: picked.slice(0, MAX_AUDIENCE + 1).map((c) => c.id) }),
  };
}

const fullName = (c: { firstName: string; lastName: string }) => `${c.firstName} ${c.lastName === "-" ? "" : c.lastName}`.trim();
