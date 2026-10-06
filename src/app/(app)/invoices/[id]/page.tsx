"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Pencil, Receipt, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog, EmptyState, ErrorState, Tone } from "@/components/common/page";
import { InvoiceDialog } from "@/components/forms/invoice-dialog";
import { invoiceStatusInfo } from "@/lib/client/constants";
import { ApiClientError } from "@/lib/client/api";
import { dateOnly, money } from "@/lib/client/format";
import { errorMessage, useItem, useRemove } from "@/lib/client/hooks";
import type { Invoice } from "@/lib/client/types";

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const remove = useRemove("invoices");
  const { data: inv, isLoading, error, refetch } = useItem<Invoice>("invoices", id);

  if (isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-32" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (error || !inv) {
    const notFound = error instanceof ApiClientError && error.status === 404;
    return (
      <Card>
        {notFound ? (
          <EmptyState icon={Receipt} title="Invoice not found" description="It may have been removed, or it belongs to someone else." action={<Button asChild variant="outline"><Link href="/invoices">Back to invoices</Link></Button>} />
        ) : (
          <ErrorState message={error?.message} onRetry={() => refetch()} />
        )}
      </Card>
    );
  }

  const items = inv.items ?? [];
  const pieces = items.reduce((n, i) => n + i.quantity, 0);
  const discount = inv.subtotal + inv.shipping - inv.total;
  const status = invoiceStatusInfo(inv.status);
  const cur = (n: number) => money(n, inv.currency);

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/invoices">
          <ArrowLeft /> Invoices
        </Link>
      </Button>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Proforma invoice {inv.number}</h1>
          <p className="text-sm text-muted-foreground">Dated {dateOnly(inv.invoiceDate)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Tone tone={status.tone}>{status.label}</Tone>
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil /> Edit
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDeleting(true)}>
            <Trash2 /> Delete
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Supplier</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="font-medium">{inv.vendorName}</p>
            {inv.vendorRep && <p>{inv.vendorRep}</p>}
            {inv.vendorPhone && <p className="text-muted-foreground">{inv.vendorPhone}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Billed to</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="font-medium">{inv.billTo}</p>
            <p className="text-muted-foreground">Owner: {inv.owner.name}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm tabular-nums">
            <Row label="Pieces" value={String(pieces)} />
            <Row label="Sheet total" value={cur(inv.subtotal)} />
            <Row label="Shipping" value={cur(inv.shipping)} />
            {discount > 0 && <Row label="Negotiated discount" value={`-${cur(discount)}`} />}
            <Row label="Deal price" value={cur(inv.total)} strong />
          </CardContent>
        </Card>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>#</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Color</TableHead>
              <TableHead className="hidden md:table-cell">Density</TableHead>
              <TableHead className="text-right">Length</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Unit</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="hidden text-right lg:table-cell">Resale</TableHead>
              <TableHead className="hidden xl:table-cell">Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="tabular-nums text-muted-foreground">{i.ref}</TableCell>
                <TableCell>
                  <p className="font-medium">{i.style}</p>
                  <p className="text-xs text-muted-foreground">{i.description}</p>
                </TableCell>
                <TableCell>{i.color ?? "—"}</TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">{i.density ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{i.lengthInches ? `${i.lengthInches}"` : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{i.quantity}</TableCell>
                <TableCell className="text-right tabular-nums">{cur(i.unitPrice)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{cur(i.lineTotal)}</TableCell>
                <TableCell className="hidden text-right tabular-nums lg:table-cell">{i.resalePrice === null ? "—" : cur(i.resalePrice)}</TableCell>
                <TableCell className="hidden text-muted-foreground xl:table-cell">{i.note ?? ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {inv.deals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Customer orders this stock is for</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {inv.deals.map((d) => (
              <Button key={d.id} asChild variant="outline" size="sm">
                <Link href="/deals">{d.title}</Link>
              </Button>
            ))}
          </CardContent>
        </Card>
      )}

      {inv.notes && <p className="text-sm text-muted-foreground">{inv.notes}</p>}

      {editing && <InvoiceDialog open onOpenChange={(o) => !o && setEditing(false)} invoice={inv} />}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete invoice?"
        description={`${inv.number} and its ${items.length} lines will be permanently deleted.`}
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(inv.id, {
            onSuccess: () => {
              toast.success("Invoice deleted");
              router.push("/invoices");
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? "border-t pt-1 font-semibold" : ""}`}>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
