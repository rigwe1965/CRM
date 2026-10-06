"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, Package } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, PageHeader, SearchInput, TableSkeleton } from "@/components/common/page";
import { useStock } from "@/lib/client/hooks";
import { cn } from "@/lib/utils";

export default function StockPage() {
  const { data, isLoading, error, refetch } = useStock();
  const [search, setSearch] = useState("");

  const q = search.trim().toLowerCase();
  const rows = (data?.rows ?? []).filter(
    (r) => !q || [r.product, r.description, r.color, r.lengthInches ?? ""].join(" ").toLowerCase().includes(q),
  );
  const bought = (data?.rows ?? []).reduce((s, r) => s + r.bought, 0);
  const sold = (data?.rows ?? []).reduce((s, r) => s + r.sold, 0);
  const onHand = (data?.rows ?? []).reduce((s, r) => s + r.onHand, 0);

  return (
    <>
      <PageHeader
        title="Stock"
        description="Pieces bought on supplier invoices, minus pieces sold on confirmed orders."
        actions={<SearchInput value={search} onChange={setSearch} placeholder="Search product, colour, length…" className="w-full sm:w-64" />}
      />

      {isLoading ? (
        <Card>
          <TableSkeleton />
        </Card>
      ) : error || !data ? (
        <Card>
          <ErrorState message={error?.message} onRetry={() => refetch()} />
        </Card>
      ) : data.rows.length === 0 ? (
        <Card>
          <EmptyState icon={Package} title="No stock yet" description="Stock appears once you add a supplier invoice with items." />
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Bought" value={bought} />
            <Stat label="Sold (confirmed orders)" value={sold} />
            <Stat label="On hand" value={onHand} />
          </div>

          <Card>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Product</TableHead>
                  <TableHead>Colour</TableHead>
                  <TableHead className="text-right">Length</TableHead>
                  <TableHead className="text-right">Bought</TableHead>
                  <TableHead className="text-right">Sold</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={`${r.product}|${r.color}|${r.lengthInches}`}>
                    <TableCell>
                      <p className="font-medium">{r.product}</p>
                      <p className="text-xs text-muted-foreground">{r.description}</p>
                    </TableCell>
                    <TableCell>{r.color || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.lengthInches ? `${r.lengthInches}"` : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.bought}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.sold}</TableCell>
                    <TableCell className={cn("text-right font-semibold tabular-nums", r.onHand < 0 && "text-destructive", r.onHand === 0 && "text-muted-foreground")}>
                      {r.onHand}
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      Nothing matches “{search}”.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>

          {data.unmatched.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="h-4 w-4 text-amber-500" /> Sales that don&apos;t match any invoice line
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  These aren&apos;t counted in the table above. Make the product, colour and length on the deal item match the invoice line (for example &quot;Pixie curl&quot;, &quot;1B&quot;, 16).
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y">
                  {data.unmatched.map((u, i) => (
                    <li key={`${u.dealId}-${i}`} className="flex flex-col gap-1 px-6 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <Link href="/deals" className="font-medium hover:underline">
                          {u.dealTitle}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {u.quantity}× {u.product}
                          {u.color ? ` · ${u.color}` : " · no colour"}
                          {u.length ? ` · ${u.length}"` : " · no length"}
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground">{u.reason}</p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}
