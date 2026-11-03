"use client";

import { useState } from "react";
import { BarChart3 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, PageHeader } from "@/components/common/page";
import { money, moneyMap } from "@/lib/client/format";
import { useCurrentUser } from "@/components/providers";
import { useReconcile, useReports } from "@/lib/client/hooks";
import type { Reports } from "@/lib/client/types";
import { MoneyOwed, SalespeopleReport, StockSellThrough, UpcomingInstalments } from "@/components/reports/money-reports";

const RANGES = [
  { value: "6", label: "Last 6 months" },
  { value: "12", label: "Last 12 months" },
  { value: "24", label: "Last 24 months" },
];

const monthLabel = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });

/** One bar chart per currency, so dollars and euros are never mixed on one scale. */
function RevenueChart({ rows }: { rows: Reports["revenueByMonth"] }) {
  const currencies = [...new Set(rows.flatMap((r) => Object.keys(r.revenue)))].sort((a, b) => (a === "USD" ? -1 : b === "USD" ? 1 : a.localeCompare(b)));
  if (currencies.length === 0) {
    return <EmptyState icon={BarChart3} title="No payments in this period" description="Payments you record on deals, and online payments, show up here by month." className="py-10" />;
  }
  return (
    <div className="space-y-6">
      {currencies.map((cur) => {
        const max = Math.max(...rows.map((r) => r.revenue[cur] ?? 0), 1);
        const total = rows.reduce((s, r) => s + (r.revenue[cur] ?? 0), 0);
        return (
          <div key={cur}>
            <p className="mb-2 text-sm font-medium">
              {cur} <span className="font-normal text-muted-foreground">· {money(total, cur)} received</span>
            </p>
            <ul className="space-y-1.5" aria-label={`Revenue by month in ${cur}`}>
              {rows.map((r) => {
                const v = r.revenue[cur] ?? 0;
                return (
                  <li key={r.month} className="grid grid-cols-[3.5rem_1fr_6rem] items-center gap-3 text-sm">
                    <span className="text-muted-foreground">{monthLabel(r.month)}</span>
                    <span className="h-4 rounded bg-muted">
                      <span className="block h-4 rounded bg-primary" style={{ width: `${(v / max) * 100}%` }} />
                    </span>
                    <span className="text-right tabular-nums">{v ? money(v, cur) : "—"}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  OVERPAID: "Overpaid",
  SCHEDULE_MISMATCH: "Instalments don't match",
  ITEMS_MISMATCH: "Line items don't match",
  ORPHAN_ONLINE_PAYMENT: "Online payment unmatched",
  PAID_LINK_WITHOUT_PAYMENT: "Paid link, no payment",
  REFUND_NEEDED: "Refund needed",
  STALE_PENDING_LINK: "Old payment link",
  UNSCHEDULED_BALANCE: "Owed, no schedule",
  CURRENCY_DRIFT: "Currency mismatch",
};

/** Admin-only: deals whose money doesn't add up. Read-only; a person fixes each one on the deal. */
function MoneyChecks() {
  const { data, isLoading, error } = useReconcile(true);
  if (isLoading) return <Skeleton className="h-24" />;
  if (error || !data) return null;
  const high = data.findings.filter((f) => f.severity === "high").length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Money checks</CardTitle>
        <CardDescription>
          {data.findings.length === 0
            ? `All ${data.checked} deals add up.`
            : `${high} to fix, ${data.findings.length - high} to tidy, across ${data.checked} deals. Nothing is changed automatically.`}
        </CardDescription>
      </CardHeader>
      {data.findings.length > 0 && (
        <CardContent className="px-0 pb-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Deal</TableHead>
                <TableHead>Problem</TableHead>
                <TableHead>What to do</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.findings.map((f, i) => (
                <TableRow key={`${f.dealId}-${f.kind}-${i}`}>
                  <TableCell className="font-medium">{f.dealTitle}</TableCell>
                  <TableCell>
                    <span className={f.severity === "high" ? "text-destructive" : "text-muted-foreground"}>{KIND_LABEL[f.kind] ?? f.kind}</span>
                    <p className="text-sm text-muted-foreground">{f.detail}</p>
                  </TableCell>
                  <TableCell className="text-sm">{f.fix}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data.truncated && <p className="px-5 pt-2 text-sm text-muted-foreground">Showing the most serious {data.findings.length}. Fix these and refresh to see the rest.</p>}
        </CardContent>
      )}
    </Card>
  );
}

export default function ReportsPage() {
  const [months, setMonths] = useState("12");
  const { data, isLoading, error, refetch } = useReports(Number(months));
  const isAdmin = useCurrentUser().role === "ADMIN";

  return (
    <>
      <PageHeader
        title="Reports"
        description="Money received, how fast customers pay, what sells, and where leads come from. Sales users see their own numbers."
        actions={
          <Select value={months} onValueChange={setMonths}>
            <SelectTrigger className="w-44" aria-label="Period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      {isLoading ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-64" />
          <Skeleton className="h-40" />
        </div>
      ) : error || !data ? (
        <Card>
          <ErrorState message={error?.message} onRetry={() => refetch()} />
        </Card>
      ) : (
        <div className="space-y-6">
          {isAdmin && <MoneyChecks />}
          <MoneyOwed />
          <UpcomingInstalments />
          <StockSellThrough />
          {isAdmin && <SalespeopleReport months={Number(months)} />}
          <Card>
            <CardHeader>
              <CardTitle>Money received by month</CardTitle>
              <CardDescription>Payments recorded on deals, one chart per currency.</CardDescription>
            </CardHeader>
            <CardContent>
              <RevenueChart rows={data.revenueByMonth} />
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Time to get paid</CardTitle>
                <CardDescription>From the order being created to the payment that completed it, on won deals that are fully paid.</CardDescription>
              </CardHeader>
              <CardContent>
                {data.daysToPay.average === null ? (
                  <p className="text-sm text-muted-foreground">No fully paid won deals yet.</p>
                ) : (
                  <>
                    <p className="text-3xl font-semibold tabular-nums">{data.daysToPay.average} days</p>
                    <p className="text-sm text-muted-foreground">average across {data.daysToPay.deals} fully paid {data.daysToPay.deals === 1 ? "deal" : "deals"}</p>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Best sellers</CardTitle>
                <CardDescription>Won deals closed in this period, by pieces sold.</CardDescription>
              </CardHeader>
              <CardContent className="px-0 pb-2">
                {data.topProducts.length === 0 ? (
                  <p className="px-5 pb-3 text-sm text-muted-foreground">No won deals with items in this period.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">Pieces</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.topProducts.map((p) => (
                        <TableRow key={p.product}>
                          <TableCell className="font-medium">{p.product}</TableCell>
                          <TableCell className="text-right tabular-nums">{p.pieces}</TableCell>
                          <TableCell className="text-right tabular-nums">{moneyMap(p.revenue)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Where leads come from</CardTitle>
              <CardDescription>Contacts added in this period by their source, and how many are now customers.</CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-2">
              {data.leadsBySource.length === 0 ? (
                <p className="px-5 pb-3 text-sm text-muted-foreground">No contacts added in this period.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Contacts</TableHead>
                      <TableHead className="text-right">Customers</TableHead>
                      <TableHead className="text-right">Became customers</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.leadsBySource.map((s) => (
                      <TableRow key={s.source}>
                        <TableCell className="font-medium">{s.source}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.contacts}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.customers}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.conversion}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
