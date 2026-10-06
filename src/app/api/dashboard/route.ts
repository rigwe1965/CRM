import { db } from "@/lib/db";
import { ok } from "@/lib/api";
import { authed } from "@/lib/route";
import { activityInclude, taskInclude } from "@/lib/includes";
import { authorScope, ownerScope, taskScope } from "@/lib/access";
import { pipelineSummary } from "@/lib/deals";
import { cashflow } from "@/lib/cashflow";
import { addMoney, type MoneyMap } from "@/lib/money";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

/**
 * GET /api/dashboard: headline numbers for the caller's own data (admins: everything).
 * Money is kept per currency (never added across currencies), as { USD: n, EUR: m }.
 */
export const GET = authed(async ({ user }) => {
  const owned = ownerScope(user);
  const live = { deletedAt: null, ...owned };
  const now = new Date();
  const since = new Date(now.getTime() - 30 * DAY);
  // Supplier invoices still count as spend unless cancelled.
  const stockWhere = { ...owned, status: { not: "CANCELLED" as const } };
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
    stockInvoices,
    stockPieces,
    cash,
    recentActivities,
    upcomingTasks,
  ] = await Promise.all([
    db.contact.groupBy({ by: ["type"], where: live, _count: { _all: true } }),
    db.organization.count({ where: live }),
    pipelineSummary(owned),
    db.deal.groupBy({ by: ["currency"], where: { ...live, stage: "CLOSED_WON" }, _count: { _all: true }, _sum: { amount: true } }),
    db.deal.groupBy({
      by: ["currency"],
      where: { ...live, stage: "CLOSED_WON", closedAt: { gte: since } },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    db.deal.count({ where: { ...live, stage: "CLOSED_LOST" } }),
    db.task.count({ where: { AND: [taskScope(user), openTask] } }),
    db.task.count({ where: { AND: [taskScope(user), openTask, { dueDate: { lt: now } }] } }),
    db.invoice.groupBy({ by: ["currency"], where: stockWhere, _count: { _all: true }, _sum: { total: true } }),
    db.invoiceItem.aggregate({ where: { invoice: stockWhere }, _sum: { quantity: true } }),
    cashflow(owned, now),
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

  const perCurrency = (rows: { currency: string; _sum: { amount?: unknown; total?: unknown } }[], field: "amount" | "total") => {
    const m: MoneyMap = {};
    for (const r of rows) addMoney(m, r.currency, Number(r._sum[field] ?? 0));
    return m;
  };
  const won = wonTotal.reduce((s, r) => s + r._count._all, 0);
  const wonRecent = wonLast30.reduce((s, r) => s + r._count._all, 0);
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
      wonTotal: perCurrency(wonTotal, "amount"),
      wonDealsTotal: won,
      wonLast30Days: perCurrency(wonLast30, "amount"),
      wonDealsLast30Days: wonRecent,
      // Share of closed deals that were won; null until a deal has been closed.
      winRate: decided === 0 ? null : Math.round((won / decided) * 1000) / 10,
    },
    stock: {
      invoiceCount: stockInvoices.reduce((s, r) => s + r._count._all, 0),
      spend: perCurrency(stockInvoices, "total"),
      pieces: stockPieces._sum.quantity ?? 0,
    },
    cashflow: cash,
    recentActivities,
    upcomingTasks,
  });
});
