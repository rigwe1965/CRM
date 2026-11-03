"use client";

import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorState } from "@/components/common/page";
import { money, moneyMap } from "@/lib/client/format";
import { request } from "@/lib/client/api";
import type { MoneyMap } from "@/lib/money";

type Bucket = "current" | "late1to30" | "late31to60" | "late60plus" | "noDueDate";
const BUCKETS: { key: Bucket; label: string }[] = [
  { key: "current", label: "Not yet due" },
  { key: "late1to30", label: "1-30 days late" },
  { key: "late31to60", label: "31-60 days late" },
  { key: "late60plus", label: "60+ days late" },
  { key: "noDueDate", label: "No due date" },
];

type Receivables = {
  asOf: string;
  truncated: boolean;
  totals: Record<string, Record<Bucket, number> & { balance: number }>;
  customers: { customerId: string | null; customer: string; currency: string; balance: number; overdue: number; deals: number; oldestDaysLate: number }[];
};
type Upcoming = { days: number; truncated: boolean; totals: MoneyMap; items: { dealId: string; title: string; customer: string; currency: string; dueDate: string; amount: number }[] };
type StockSales = { rows: { key: string; product: string; color: string; lengthInches: number | null; bought: number; sold: number; onHand: number; sellThrough: number | null; low: boolean }[] };
type Salespeople = { people: { userId: string; name: string; won: number; lost: number; conversion: number | null; wonValue: MoneyMap; openDeals: number; openValue: MoneyMap; collected: MoneyMap }[] };

const useReport = <T,>(path: string, enabled = true) =>
  useQuery({ queryKey: ["reports", path], enabled, queryFn: async () => (await request<{ data: T }>("GET", path)).data });

/** A plain link, not a fetch: the browser downloads the file with the signed-in session. */
function CsvLink({ href }: { href: string }) {
  return (
    <Button asChild variant="outline" size="sm">
      <a href={href} download>
        <Download className="mr-1.5 h-4 w-4" aria-hidden /> CSV
      </a>
    </Button>
  );
}

function Body<T>({ q, children }: { q: { data?: T; isLoading: boolean; error: Error | null; refetch: () => unknown }; children: (d: T) => React.ReactNode }) {
  if (q.isLoading) return <Skeleton className="h-32" />;
  if (q.error || !q.data) return <ErrorState message={q.error?.message} onRetry={() => q.refetch()} />;
  return <>{children(q.data)}</>;
}

export function MoneyOwed() {
  const q = useReport<Receivables>("/api/reports/receivables");
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Money owed</CardTitle>
          <CardDescription>What customers still owe on won deals and on deals with an instalment plan, by how late it is. Each currency is shown on its own.</CardDescription>
        </div>
        <CsvLink href="/api/reports/receivables?format=csv" />
      </CardHeader>
      <CardContent className="space-y-6 px-0 pb-2">
        <Body q={q}>
          {(r) =>
            r.customers.length === 0 ? (
              <p className="px-5 pb-3 text-sm text-muted-foreground">Nothing is owed right now.</p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Currency</TableHead>
                      {BUCKETS.map((b) => (
                        <TableHead key={b.key} className="text-right">{b.label}</TableHead>
                      ))}
                      <TableHead className="text-right">Total owed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(r.totals).map(([cur, t]) => (
                      <TableRow key={cur}>
                        <TableCell className="font-medium">{cur}</TableCell>
                        {BUCKETS.map((b) => (
                          <TableCell key={b.key} className={`text-right tabular-nums ${b.key.startsWith("late") && t[b.key] > 0 ? "text-destructive" : ""}`}>
                            {t[b.key] ? money(t[b.key], cur) : "—"}
                          </TableCell>
                        ))}
                        <TableCell className="text-right font-medium tabular-nums">{money(t.balance, cur)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead className="text-right">Deals</TableHead>
                      <TableHead className="text-right">Overdue</TableHead>
                      <TableHead className="text-right">Oldest (days late)</TableHead>
                      <TableHead className="text-right">Owes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.customers.slice(0, 25).map((c) => (
                      <TableRow key={`${c.customerId ?? "none"}-${c.currency}`}>
                        <TableCell className="font-medium">{c.customer}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.deals}</TableCell>
                        <TableCell className={`text-right tabular-nums ${c.overdue > 0 ? "text-destructive" : ""}`}>{c.overdue ? money(c.overdue, c.currency) : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.oldestDaysLate || "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(c.balance, c.currency)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {(r.customers.length > 25 || r.truncated) && (
                  <p className="px-5 text-sm text-muted-foreground">
                    Showing the 25 customers who owe the most overdue{r.truncated ? "; the report read only the newest 5,000 deals" : ""}. The CSV has every deal.
                  </p>
                )}
              </>
            )
          }
        </Body>
      </CardContent>
    </Card>
  );
}

export function UpcomingInstalments() {
  const q = useReport<Upcoming>("/api/reports/upcoming?days=30");
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Money due in the next 30 days</CardTitle>
          <CardDescription>Unpaid instalments falling due, oldest first. Overdue ones are under Money owed.</CardDescription>
        </div>
        <CsvLink href="/api/reports/upcoming?days=30&format=csv" />
      </CardHeader>
      <CardContent className="px-0 pb-2">
        <Body q={q}>
          {(r) =>
            r.items.length === 0 ? (
              <p className="px-5 pb-3 text-sm text-muted-foreground">No instalments fall due in the next {r.days} days.</p>
            ) : (
              <>
                <p className="px-5 pb-2 text-sm text-muted-foreground">Expected: <span className="font-medium text-foreground">{moneyMap(r.totals)}</span></p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Due</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Deal</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.items.slice(0, 25).map((i, n) => (
                      <TableRow key={`${i.dealId}-${i.dueDate}-${n}`}>
                        <TableCell className="tabular-nums">{i.dueDate}</TableCell>
                        <TableCell>{i.customer}</TableCell>
                        <TableCell className="text-muted-foreground">{i.title}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(i.amount, i.currency)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {r.items.length > 25 && <p className="px-5 pt-2 text-sm text-muted-foreground">Showing the first 25 of {r.items.length}. The CSV has all of them.</p>}
              </>
            )
          }
        </Body>
      </CardContent>
    </Card>
  );
}

export function StockSellThrough() {
  const q = useReport<StockSales>("/api/reports/stock-sales");
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>What sells, and what is left</CardTitle>
          <CardDescription>Each product, colour and length by pieces sold, with the share of what was bought that has sold.</CardDescription>
        </div>
        <CsvLink href="/api/reports/stock-sales?format=csv" />
      </CardHeader>
      <CardContent className="px-0 pb-2">
        <Body q={q}>
          {(r) =>
            r.rows.length === 0 ? (
              <p className="px-5 pb-3 text-sm text-muted-foreground">No stock records yet.</p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Bought</TableHead>
                      <TableHead className="text-right">Sold</TableHead>
                      <TableHead className="text-right">Sold %</TableHead>
                      <TableHead className="text-right">On hand</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.rows.slice(0, 25).map((s) => (
                      <TableRow key={s.key}>
                        <TableCell className="font-medium">
                          {s.product} {s.color} {s.lengthInches ? `${s.lengthInches}"` : ""}
                          {s.low && <span className="ml-2 text-xs text-destructive">low</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{s.bought}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.sold}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.sellThrough === null ? "—" : `${s.sellThrough}%`}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.onHand}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {r.rows.length > 25 && <p className="px-5 pt-2 text-sm text-muted-foreground">Showing the top 25 of {r.rows.length}. The CSV has all of them.</p>}
              </>
            )
          }
        </Body>
      </CardContent>
    </Card>
  );
}

export function SalespeopleReport({ months }: { months: number }) {
  const q = useReport<Salespeople>(`/api/reports/salespeople?months=${months}`);
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Per salesperson</CardTitle>
          <CardDescription>Deals won and lost in this period, the share won, value won, what is still open, and money collected. Admins only.</CardDescription>
        </div>
        <CsvLink href={`/api/reports/salespeople?months=${months}&format=csv`} />
      </CardHeader>
      <CardContent className="px-0 pb-2">
        <Body q={q}>
          {(r) =>
            r.people.length === 0 ? (
              <p className="px-5 pb-3 text-sm text-muted-foreground">No deals or payments in this period.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Salesperson</TableHead>
                    <TableHead className="text-right">Won</TableHead>
                    <TableHead className="text-right">Lost</TableHead>
                    <TableHead className="text-right">Won %</TableHead>
                    <TableHead className="text-right">Value won</TableHead>
                    <TableHead className="text-right">Open pipeline</TableHead>
                    <TableHead className="text-right">Collected</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.people.map((p) => (
                    <TableRow key={p.userId}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.won}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.lost}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.conversion === null ? "—" : `${p.conversion}%`}</TableCell>
                      <TableCell className="text-right tabular-nums">{moneyMap(p.wonValue)}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.openDeals ? `${p.openDeals} · ${moneyMap(p.openValue)}` : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{moneyMap(p.collected)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          }
        </Body>
      </CardContent>
    </Card>
  );
}
