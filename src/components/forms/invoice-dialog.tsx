"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/common/page";
import { currencyOptions, INVOICE_STATUSES } from "@/lib/client/constants";
import { toDateInput } from "@/lib/client/format";
import { useList, useSave } from "@/lib/client/hooks";
import type { ImportedItem } from "@/lib/client/invoice-import";
import type { Deal, Invoice, InvoiceStatus } from "@/lib/client/types";
import { FormShell, Grid2, nullable, useFormState } from "./form-kit";

type ItemState = {
  key: number;
  ref: string;
  style: string;
  description: string;
  color: string;
  density: string;
  lengthInches: string;
  quantity: string;
  unitPrice: string;
  resalePrice: string;
  note: string;
  // Supplier sheets round per line; keep the stored line total unless quantity/price change.
  original?: { quantity: string; unitPrice: string; lineTotal: number };
};

let nextKey = 0;
const blankItem = (n: number): ItemState => ({
  key: nextKey++,
  ref: String(n),
  style: "",
  description: "",
  color: "",
  density: "",
  lengthInches: "",
  quantity: "1",
  unitPrice: "",
  resalePrice: "",
  note: "",
});

export function InvoiceDialog({
  open,
  onOpenChange,
  invoice,
  initialItems,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  invoice?: Invoice;
  /** Lines read from an imported spreadsheet, to review before saving a new invoice. */
  initialItems?: ImportedItem[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <InvoiceForm invoice={invoice} initialItems={initialItems} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function InvoiceForm({ invoice, initialItems, onClose }: { invoice?: Invoice; initialItems?: ImportedItem[]; onClose: () => void }) {
  const save = useSave<Invoice>("invoices", invoice?.id);
  const form = useFormState();
  const deals = useList<Deal>("deals", { pageSize: 100, sort: "title", order: "asc" });

  const [v, setV] = useState({
    number: invoice?.number ?? "",
    status: (invoice?.status ?? "DRAFT") as InvoiceStatus,
    invoiceDate: toDateInput(invoice?.invoiceDate) || new Date().toISOString().slice(0, 10),
    currency: invoice?.currency ?? "USD",
    vendorName: invoice?.vendorName ?? "",
    vendorRep: invoice?.vendorRep ?? "",
    vendorPhone: invoice?.vendorPhone ?? "",
    billTo: invoice?.billTo ?? "",
    shipping: invoice ? String(invoice.shipping) : "",
    total: invoice ? String(invoice.total) : "",
    notes: invoice?.notes ?? "",
  });
  const [dealIds, setDealIds] = useState<string[]>(invoice?.deals.map((d) => d.id) ?? []);
  const [items, setItems] = useState<ItemState[]>(() =>
    invoice?.items?.length
      ? invoice.items.map((i) => ({
          key: nextKey++,
          ref: i.ref,
          style: i.style,
          description: i.description,
          color: i.color ?? "",
          density: i.density ?? "",
          lengthInches: i.lengthInches ? String(i.lengthInches) : "",
          quantity: String(i.quantity),
          unitPrice: String(i.unitPrice),
          resalePrice: i.resalePrice === null ? "" : String(i.resalePrice),
          note: i.note ?? "",
          original: { quantity: String(i.quantity), unitPrice: String(i.unitPrice), lineTotal: i.lineTotal },
        }))
      : initialItems?.length
        ? initialItems.map((i) => ({
            key: nextKey++,
            ref: i.ref,
            style: i.style,
            description: i.description,
            color: i.color,
            density: i.density,
            lengthInches: i.lengthInches ? String(i.lengthInches) : "",
            quantity: String(i.quantity),
            unitPrice: String(i.unitPrice),
            resalePrice: i.resalePrice === null ? "" : String(i.resalePrice),
            note: i.note,
            // Keep the sheet's own (rounded) line total when it differs from quantity x price.
            original:
              i.lineTotal !== null && Math.round(i.quantity * i.unitPrice * 100) !== Math.round(i.lineTotal * 100)
                ? { quantity: String(i.quantity), unitPrice: String(i.unitPrice), lineTotal: i.lineTotal }
                : undefined,
          }))
        : [blankItem(1)],
  );
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));
  const setItem = (key: number, patch: Partial<ItemState>) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const dealOptions = [...(deals.data?.data ?? []).map((d) => ({ id: d.id, title: d.title }))];
  for (const d of invoice?.deals ?? []) if (!dealOptions.some((o) => o.id === d.id)) dealOptions.push(d);

  const num = (s: string) => (s.trim() === "" ? undefined : Number(s));

  return (
    <FormShell
      title={invoice ? "Edit invoice" : "New supplier invoice"}
      description={invoice ? undefined : initialItems?.length ? `${initialItems.length} lines imported from your file. Check them, add the invoice details, then save.` : "Record a stock order from a supplier."}
      submitLabel={invoice ? "Save changes" : "Create invoice"}
      pending={save.isPending}
      formError={form.formError}
      onCancel={onClose}
      onSubmit={async () => {
        const ok = await form.run(() =>
          save.mutateAsync({
            number: v.number,
            status: v.status,
            invoiceDate: v.invoiceDate,
            currency: v.currency || undefined,
            vendorName: v.vendorName,
            vendorRep: nullable(v.vendorRep),
            vendorPhone: nullable(v.vendorPhone),
            billTo: v.billTo,
            shipping: num(v.shipping),
            total: num(v.total),
            notes: nullable(v.notes),
            dealIds,
            items: items.map((i) => {
              const unchanged = i.original && i.original.quantity === i.quantity && i.original.unitPrice === i.unitPrice;
              return {
                ref: i.ref,
                style: i.style,
                description: i.description,
                color: nullable(i.color),
                density: nullable(i.density),
                lengthInches: num(i.lengthInches) ?? null,
                quantity: num(i.quantity),
                unitPrice: num(i.unitPrice),
                lineTotal: unchanged ? i.original!.lineTotal : undefined,
                resalePrice: num(i.resalePrice) ?? null,
                note: nullable(i.note),
              };
            }),
          }),
        );
        if (ok) {
          toast.success(invoice ? "Invoice updated" : "Invoice created");
          onClose();
        }
      }}
    >
      <Grid2>
        <FormField label="Invoice number" error={form.err("number")}>
          <Input value={v.number} onChange={(e) => set("number", e.target.value)} placeholder="PI-20250807-001" autoFocus />
        </FormField>
        <FormField label="Invoice date" error={form.err("invoiceDate")}>
          <Input type="date" value={v.invoiceDate} onChange={(e) => set("invoiceDate", e.target.value)} />
        </FormField>
      </Grid2>
      <Grid2>
        <FormField label="Supplier" error={form.err("vendorName")}>
          <Input value={v.vendorName} onChange={(e) => set("vendorName", e.target.value)} />
        </FormField>
        <FormField label="Billed to" error={form.err("billTo")}>
          <Input value={v.billTo} onChange={(e) => set("billTo", e.target.value)} />
        </FormField>
        <FormField label="Supplier contact person" error={form.err("vendorRep")}>
          <Input value={v.vendorRep} onChange={(e) => set("vendorRep", e.target.value)} />
        </FormField>
        <FormField label="Supplier phone" error={form.err("vendorPhone")}>
          <Input value={v.vendorPhone} onChange={(e) => set("vendorPhone", e.target.value)} />
        </FormField>
      </Grid2>
      <div className="grid gap-4 sm:grid-cols-4">
        <FormField label="Status">
          <Select value={v.status} onValueChange={(s) => set("status", s as InvoiceStatus)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INVOICE_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Currency" error={form.err("currency")}>
          <Select value={v.currency} onValueChange={(c) => set("currency", c)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {currencyOptions(invoice?.currency).map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Shipping" error={form.err("shipping")}>
          <Input type="number" min={0} step="0.01" value={v.shipping} onChange={(e) => set("shipping", e.target.value)} placeholder="0" />
        </FormField>
        <FormField label="Deal price" error={form.err("total")} hint="Blank = items + shipping">
          <Input type="number" min={0} step="0.01" value={v.total} onChange={(e) => set("total", e.target.value)} />
        </FormField>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Items ({items.length})</Label>
          <Button type="button" variant="outline" size="sm" onClick={() => setItems((l) => [...l, blankItem(l.length + 1)])}>
            <Plus /> Add item
          </Button>
        </div>
        {form.err("items") && <p role="alert" className="text-xs text-destructive">{form.err("items")}</p>}
        <div className="space-y-2">
          {items.map((i, n) => (
            <div key={i.key} className="grid grid-cols-2 gap-2 rounded-md border p-2 sm:grid-cols-12">
              <Input className="sm:col-span-1" aria-label={`Item ${n + 1} ref`} placeholder="Ref" value={i.ref} onChange={(e) => setItem(i.key, { ref: e.target.value })} />
              <Input className="sm:col-span-3" aria-label={`Item ${n + 1} style`} placeholder="Style (e.g. Pixie curl)" value={i.style} onChange={(e) => setItem(i.key, { style: e.target.value })} />
              <Input className="col-span-2 sm:col-span-5" aria-label={`Item ${n + 1} description`} placeholder="Description (e.g. SDD 5*5 closure pixie curl)" value={i.description} onChange={(e) => setItem(i.key, { description: e.target.value })} />
              <Input className="sm:col-span-2" aria-label={`Item ${n + 1} color`} placeholder="Color" value={i.color} onChange={(e) => setItem(i.key, { color: e.target.value })} />
              <Button type="button" variant="ghost" size="icon" className="justify-self-end sm:col-span-1" aria-label={`Remove item ${n + 1}`} disabled={items.length === 1} onClick={() => setItems((l) => l.filter((x) => x.key !== i.key))}>
                <Trash2 />
              </Button>
              <Input className="sm:col-span-3" aria-label={`Item ${n + 1} density`} placeholder="Density / weight" value={i.density} onChange={(e) => setItem(i.key, { density: e.target.value })} />
              <Input className="sm:col-span-1" type="number" min={1} aria-label={`Item ${n + 1} length`} placeholder='Inches' value={i.lengthInches} onChange={(e) => setItem(i.key, { lengthInches: e.target.value })} />
              <Input className="sm:col-span-1" type="number" min={1} aria-label={`Item ${n + 1} quantity`} placeholder="Qty" value={i.quantity} onChange={(e) => setItem(i.key, { quantity: e.target.value })} />
              <Input className="sm:col-span-2" type="number" min={0} step="0.01" aria-label={`Item ${n + 1} unit price`} placeholder="Unit price" value={i.unitPrice} onChange={(e) => setItem(i.key, { unitPrice: e.target.value })} />
              <Input className="sm:col-span-2" type="number" min={0} step="0.01" aria-label={`Item ${n + 1} resale price`} placeholder="Resale price" value={i.resalePrice} onChange={(e) => setItem(i.key, { resalePrice: e.target.value })} />
              <Input className="col-span-2 sm:col-span-3" aria-label={`Item ${n + 1} note`} placeholder="Note (e.g. long closure)" value={i.note} onChange={(e) => setItem(i.key, { note: e.target.value })} />
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Line totals and the sheet total are worked out for you.</p>
      </div>

      <div className="space-y-2">
        <Label>Customer orders this stock is for</Label>
        {dealOptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No deals to link yet.</p>
        ) : (
          <div className="grid max-h-40 gap-2 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">
            {dealOptions.map((d) => (
              <label key={d.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={dealIds.includes(d.id)}
                  onCheckedChange={(c) => setDealIds((l) => (c ? [...l, d.id] : l.filter((x) => x !== d.id)))}
                />
                <span className="truncate">{d.title}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <FormField label="Notes" error={form.err("notes")}>
        <Textarea rows={2} value={v.notes} onChange={(e) => set("notes", e.target.value)} />
      </FormField>
    </FormShell>
  );
}
