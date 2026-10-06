"use client";

import Link from "next/link";
import { Activity as ActivityIcon, CheckSquare, AlertTriangle, Banknote, CircleDollarSign, Coins, PiggyBank, Receipt, TrendingUp, Users, type LucideIcon } from "lucide-react";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/components/providers";
import { ActivityItem, TaskRow } from "@/components/common/items";
import { EmptyState, ErrorState, PageHeader } from "@/components/common/page";
import { CONTACT_TYPES, DEAL_STAGES } from "@/lib/client/constants";
import { money } from "@/lib/client/format";
import { useDashboard } from "@/lib/client/hooks";
import type { ContactType } from "@/lib/client/types";

const TOOLTIP_STYLE = {
  background: "hsl(var(--popover))",
  color: "hsl(var(--popover-foreground))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize: 12,
};

const TYPE_COLORS: Record<ContactType, string> = {
  LEAD: "#38bdf8",
  PROSPECT: "#f59e0b",
  CUSTOMER: "#10b981",
  PARTNER: "#818cf8",
  OTHER: "#cbd5e1",
};

function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  href,
}: {
  title: string;
  value: string;
  sub: React.ReactNode;
  icon: LucideIcon;
  href: string;
}) {
  return (
    <Link href={href} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="transition-shadow hover:shadow-md">
        <CardContent className="flex items-start justify-between p-5">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
          </div>
          <div className="rounded-lg bg-accent p-2 text-accent-foreground">
            <Icon className="h-5 w-5" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading dashboard">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-80 lg:col-span-2" />
        <Skeleton className="h-80" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const user = useCurrentUser();
  const { data, isLoading, error, refetch } = useDashboard();
  const firstName = user.name.split(" ")[0];
  // Lost deals would dwarf the chart without telling you anything about the live pipeline.
  const chartStages = (data?.pipeline.stages ?? []).filter((s) => s.stage !== "CLOSED_LOST");

  return (
    <>
      <PageHeader
        title={`Welcome back, ${firstName}`}
        description={user.role === "ADMIN" ? "Here's everything across the team." : "Here's how your pipeline looks today."}
        actions={
          <Button asChild>
            <Link href="/deals">View pipeline</Link>
          </Button>
        }
      />

      {isLoading ? (
        <DashboardSkeleton />
      ) : error || !data ? (
        <Card>
          <ErrorState message={error?.message} onRetry={() => refetch()} />
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard
              title="Open pipeline"
              value={money(data.pipeline.openAmount)}
              sub={`${money(data.pipeline.openWeightedAmount)} weighted · ${data.pipeline.openCount} ${data.pipeline.openCount === 1 ? "deal" : "deals"}`}
              icon={CircleDollarSign}
              href="/deals"
            />
            <StatCard
              title="Completed (last 30 days)"
              value={money(data.revenue.wonLast30Days)}
              sub={`${data.revenue.wonDealsLast30Days} ${data.revenue.wonDealsLast30Days === 1 ? "deal" : "deals"} · win rate ${data.revenue.winRate === null ? "n/a" : `${data.revenue.winRate}%`}`}
              icon={TrendingUp}
              href="/deals"
            />
            <StatCard
              title="Stock spend"
              value={money(data.stock.spend)}
              sub={`${data.stock.pieces} ${data.stock.pieces === 1 ? "piece" : "pieces"} · ${data.stock.invoiceCount} ${data.stock.invoiceCount === 1 ? "invoice" : "invoices"}`}
              icon={Receipt}
              href="/invoices"
            />
            <StatCard
              title="Contacts"
              value={String(data.counts.contacts)}
              sub={`${data.counts.contactsByType.LEAD ?? 0} leads · ${data.counts.contactsByType.CUSTOMER ?? 0} customers`}
              icon={Users}
              href="/contacts"
            />
            <StatCard
              title="Open tasks"
              value={String(data.counts.openTasks)}
              sub={
                data.counts.overdueTasks > 0 ? (
                  <span className="font-medium text-destructive">{data.counts.overdueTasks} overdue</span>
                ) : (
                  "Nothing overdue"
                )
              }
              icon={CheckSquare}
              href="/tasks"
            />
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Cash flow</h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                title="Collected"
                value={money(data.cashflow.collected.total)}
                sub={`${money(data.cashflow.collected.last30Days)} in the last 30 days`}
                icon={Banknote}
                href="/deals"
              />
              <StatCard
                title="Still owed to you"
                value={money(data.cashflow.owed.amount)}
                sub={`${data.cashflow.owed.deals} ${data.cashflow.owed.deals === 1 ? "confirmed order" : "confirmed orders"} with a balance`}
                icon={Coins}
                href="/deals"
              />
              <StatCard
                title="Overdue instalments"
                value={money(data.cashflow.overdue.amount)}
                sub={
                  data.cashflow.overdue.deals > 0 ? (
                    <span className="font-medium text-destructive">
                      {data.cashflow.overdue.deals} {data.cashflow.overdue.deals === 1 ? "customer is" : "customers are"} late
                    </span>
                  ) : (
                    "Nobody is late"
                  )
                }
                icon={AlertTriangle}
                href="/deals"
              />
              <StatCard
                title="Est. profit on stock"
                value={money(data.cashflow.profit.estimated)}
                sub={
                  data.cashflow.profit.margin === null
                    ? "Add resale prices to invoice items"
                    : `${data.cashflow.profit.margin}% margin if sold at your resale prices`
                }
                icon={PiggyBank}
                href="/invoices"
              />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Pipeline by stage <span className="text-xs font-normal text-muted-foreground">(open + won)</span></CardTitle>
              </CardHeader>
              <CardContent>
                {chartStages.every((s) => s.count === 0) ? (
                  <EmptyState icon={CircleDollarSign} title="No deals yet" description="Create your first deal to see the pipeline." className="py-10" />
                ) : (
                  <div className="h-64" role="img" aria-label="Bar chart of deal value by pipeline stage">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={chartStages.map((s) => ({
                          name: DEAL_STAGES.find((d) => d.value === s.stage)!.label,
                          stage: s.stage,
                          amount: s.amount,
                          count: s.count,
                        }))}
                        margin={{ left: 0, right: 8, top: 8 }}
                      >
                        <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} stroke="hsl(var(--muted-foreground))" />
                        <YAxis tickLine={false} axisLine={false} fontSize={12} width={56} stroke="hsl(var(--muted-foreground))" tickFormatter={(v: number) => money(v, "USD", true)} />
                        <Tooltip
                          contentStyle={TOOLTIP_STYLE}
                          cursor={{ fill: "hsl(var(--muted))" }}
                          formatter={(value, _n, item) => [`${money(Number(value))} (${item.payload.count} deals)`, "Value"]}
                        />
                        <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                          {chartStages.map((s) => (
                            <Cell key={s.stage} fill={DEAL_STAGES.find((d) => d.value === s.stage)!.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Contacts by type</CardTitle>
              </CardHeader>
              <CardContent>
                {data.counts.contacts === 0 ? (
                  <EmptyState icon={Users} title="No contacts yet" className="py-10" />
                ) : (
                  <>
                    <div className="h-44" role="img" aria-label="Donut chart of contacts by type">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={CONTACT_TYPES.map((t) => ({ name: t.label, type: t.value, value: data.counts.contactsByType[t.value] ?? 0 })).filter((d) => d.value > 0)}
                            dataKey="value"
                            innerRadius={48}
                            outerRadius={72}
                            paddingAngle={2}
                            stroke="hsl(var(--card))"
                          >
                            {CONTACT_TYPES.filter((t) => (data.counts.contactsByType[t.value] ?? 0) > 0).map((t) => (
                              <Cell key={t.value} fill={TYPE_COLORS[t.value]} />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: "hsl(var(--popover-foreground))" }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <ul className="mt-2 space-y-1.5 text-sm">
                      {CONTACT_TYPES.filter((t) => (data.counts.contactsByType[t.value] ?? 0) > 0).map((t) => (
                        <li key={t.value} className="flex items-center justify-between">
                          <span className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ background: TYPE_COLORS[t.value] }} />
                            {t.label}
                          </span>
                          <span className="tabular-nums text-muted-foreground">{data.counts.contactsByType[t.value]}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle>Recent activity</CardTitle>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/activities">View all</Link>
                </Button>
              </CardHeader>
              <CardContent className="px-0 pb-2">
                {data.recentActivities.length === 0 ? (
                  <EmptyState icon={ActivityIcon} title="No activity yet" description="Log a call, email or meeting to see it here." className="py-10" />
                ) : (
                  <div className="divide-y">
                    {data.recentActivities.slice(0, 6).map((a) => (
                      <ActivityItem key={a.id} activity={a} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle>Upcoming tasks</CardTitle>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/tasks">View all</Link>
                </Button>
              </CardHeader>
              <CardContent className="px-0 pb-2">
                {data.upcomingTasks.length === 0 ? (
                  <EmptyState icon={CheckSquare} title="You're all caught up" description="Tasks with a due date show up here." className="py-10" />
                ) : (
                  <div className="divide-y">
                    {data.upcomingTasks.map((t) => (
                      <TaskRow key={t.id} task={t} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
