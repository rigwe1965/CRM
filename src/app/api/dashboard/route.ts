import { db } from "@/lib/db";
import { ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { activityInclude, taskInclude } from "@/lib/includes";
import { authorScope, ownerScope, taskScope } from "@/lib/access";
import { pipelineSummary } from "@/lib/deals";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

/**
 * GET /api/dashboard: headline numbers for the caller's own data (admins: everything).
 * Amounts are summed as plain numbers, so a single currency is assumed.
 */
export const GET = authed(async ({ user }) => {
  const owned = ownerScope(user);
  const live = { deletedAt: null, ...owned };
  const now = new Date();
  const since = new Date(now.getTime() - 30 * DAY);
  const openTask = { status: { in: ["TODO", "IN_PROGRESS"] as ("TODO" | "IN_PROGRESS")[] } };

  const [
    contactsByType,
    organizations,
    pipeline,
    wonTotal,
    wonLast30,
    lostCount,
    openTasks,
    overdueTasks,
    recentActivities,
    upcomingTasks,
  ] = await Promise.all([
    db.contact.groupBy({ by: ["type"], where: live, _count: { _all: true } }),
    db.organization.count({ where: live }),
    pipelineSummary(owned),
    db.deal.aggregate({ where: { ...live, stage: "CLOSED_WON" }, _count: { _all: true }, _sum: { amount: true } }),
    db.deal.aggregate({
      where: { ...live, stage: "CLOSED_WON", closedAt: { gte: since } },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    db.deal.count({ where: { ...live, stage: "CLOSED_LOST" } }),
    db.task.count({ where: { AND: [taskScope(user), openTask] } }),
    db.task.count({ where: { AND: [taskScope(user), openTask, { dueDate: { lt: now } }] } }),
    db.activity.findMany({
      where: authorScope(user),
      include: activityInclude,
      orderBy: { occurredAt: "desc" },
      take: 10,
    }),
    db.task.findMany({
      where: { AND: [taskScope(user), openTask, { dueDate: { not: null } }] },
      include: taskInclude,
      orderBy: { dueDate: "asc" },
      take: 5,
    }),
  ]);

  const won = wonTotal._count._all;
  const decided = won + lostCount;
  const contacts = Object.fromEntries(contactsByType.map((r) => [r.type, r._count._all]));

  return ok({
    counts: {
      contacts: contactsByType.reduce((s, r) => s + r._count._all, 0),
      contactsByType: contacts,
      organizations,
      openDeals: pipeline.openCount,
      openTasks,
      overdueTasks,
    },
    pipeline,
    revenue: {
      wonTotal: Number(wonTotal._sum.amount ?? 0),
      wonDealsTotal: won,
      wonLast30Days: Number(wonLast30._sum.amount ?? 0),
      wonDealsLast30Days: wonLast30._count._all,
      // Share of closed deals that were won; null until a deal has been closed.
      winRate: decided === 0 ? null : Math.round((won / decided) * 1000) / 10,
    },
    recentActivities,
    upcomingTasks,
  });
});
