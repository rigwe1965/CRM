"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, PageHeader, Pagination, SearchInput, TableSkeleton, Tone, useDebounced } from "@/components/common/page";
import { InvoiceDialog } from "@/components/forms/invoice-dialog";
import { invoiceStatusInfo } from "@/lib/client/constants";
import { dateOnly, money } from "@/lib/client/format";
import { useList } from "@/lib/client/hooks";
import type { Invoice } from "@/lib/client/types";

export default function InvoicesPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const q = useDebounced(search);
  const { data, isLoading, isFetching, error, refetch } = useList<Invoice>("invoices", { page, pageSize: 15, q, sort: "invoiceDate", order: "desc" });

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Supplier proforma invoices for stock orders."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New invoice
          </Button>
        }
      />

      <Card>
        <div className="border-b p-4">
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Search number, customer or supplier…"
            className="sm:max-w-xs"
          />
        </div>

        {isLoading ? (
          <TableSkeleton />
        ) : error ? (
          <ErrorState message={error.message} onRetry={() => refetch()} />
        ) : data && data.data.length === 0 ? (
          <EmptyState icon={Receipt} title={q ? "No invoices match your search" : "No invoices yet"} description={q ? "Try a different number or name." : "Record a stock order from a supplier."} action={q ? undefined : <Button onClick={() => setCreating(true)}><Plus /> New invoice</Button>} />
        ) : (
          data && (
            <div className={isFetching ? "opacity-70 transition-opacity" : "transition-opacity"}>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Invoice</TableHead>
                    <TableHead className="hidden md:table-cell">Supplier</TableHead>
                    <TableHead className="hidden sm:table-cell">Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">Lines</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((inv) => {
                    const status = invoiceStatusInfo(inv.status);
                    return (
                      <TableRow key={inv.id} className="cursor-pointer" onClick={() => router.push(`/invoices/${inv.id}`)}>
                        <TableCell>
                          <Link href={`/invoices/${inv.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                            {inv.number}
                          </Link>
                          <p className="text-xs text-muted-foreground">To: {inv.billTo}</p>
                        </TableCell>
                        <TableCell className="hidden max-w-[16rem] truncate text-muted-foreground md:table-cell">{inv.vendorName}</TableCell>
                        <TableCell className="hidden text-muted-foreground sm:table-cell">{dateOnly(inv.invoiceDate)}</TableCell>
                        <TableCell>
                          <Tone tone={status.tone}>{status.label}</Tone>
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums lg:table-cell">{inv._count?.items ?? 0}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{money(inv.total, inv.currency)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <Pagination meta={data.meta} onPage={setPage} noun="invoices" />
            </div>
          )
        )}
      </Card>

      <InvoiceDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
