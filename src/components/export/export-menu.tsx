"use client";

import { useState } from "react";
import { Download, ListChecks } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/common/page";
import { qs, type Query } from "@/lib/client/api";
import { downloadFile } from "@/lib/client/download";
import { money } from "@/lib/client/format";
import { errorMessage, useList, type Resource } from "@/lib/client/hooks";
import type { InvoiceItem } from "@/lib/client/types";

/** How many rows the "Choose rows" window lists (the list API's page limit). More than that: narrow with the screen's search. */
const CHOOSE_LIMIT = 100;

type Shown = { title: string; detail?: string };
type Row = { id: string } & Shown;

/**
 * Lets the person pick individual rows to export. Rows come from the list API (`resource`, described by
 * `describe`) or, when the screen already holds them (stock), straight from `rows`. `param` is the name the
 * export takes the picked ids under (`ids` by default, `dealIds` when picking deals for their items or payments,
 * `keys` for stock), `encode` is applied to each id first, and `listParams` are the filters for the list shown.
 */
export type ChooseSpec = {
  param?: string;
  encode?: (id: string) => string;
  listParams?: Query;
  /** One line telling what ticking a row means, when it is not obvious. */
  hint?: string;
} & ({ resource: Resource; describe: (row: never) => Shown } | { rows: Row[] });

/** Typed way to build a ChooseSpec for one kind of row. */
export const chooseRows = <T extends { id: string }>(
  resource: Resource,
  describe: (row: T) => Shown,
  extra: Pick<ChooseSpec, "param" | "listParams" | "hint"> = {},
): ChooseSpec => ({ resource, describe: describe as (row: never) => Shown, ...extra });

/** ChooseSpec for rows the screen already has (the stock list). */
export const chooseFromRows = (rows: Row[], extra: Pick<ChooseSpec, "param" | "encode" | "hint">): ChooseSpec => ({ rows, ...extra });

export type ExportItem = {
  label: string;
  /** The name in /api/export/<entity>. */
  entity: string;
  /** The same filters the screen is showing, so the file matches what you see. */
  params?: Query;
  /** Rows the file will have, when the screen knows. */
  count?: number;
  /** When set, the menu also offers "choose rows…": export only the rows the person ticks. */
  choose?: ChooseSpec;
};

const NOTICE =
  "The file may contain customer names and payment amounts. Keep it private and delete it when you no longer need it. This export is recorded in the audit log.";

/**
 * "Export" button with a menu of the files this screen can produce. Choosing one asks for confirmation
 * (with the row count when known) and then downloads it. Areas with `choose` also offer "choose rows…",
 * where nothing is ticked to begin with, so a file only ever holds rows someone picked on purpose.
 * Exports are limited per person, so the dialog does not offer a way to repeat one by accident.
 */
export function ExportMenu({ items }: { items: ExportItem[] }) {
  const [chosen, setChosen] = useState<ExportItem | null>(null);
  const [picking, setPicking] = useState<ExportItem | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(item: ExportItem) {
    setBusy(true);
    try {
      const name = await downloadFile("GET", `/api/export/${item.entity}${qs(item.params)}`);
      toast.success(`Downloaded ${name}`);
      setChosen(null);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            <Download /> Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {items.flatMap((item) => [
            ...(item.choose
              ? [
                  <DropdownMenuItem key={`${item.entity}:pick`} onSelect={() => setPicking(item)}>
                    <ListChecks /> Choose rows: {item.label}
                  </DropdownMenuItem>,
                ]
              : []),
            <DropdownMenuItem key={item.entity} onSelect={() => setChosen(item)}>
              {item.choose ? `All matching: ${item.label}` : item.label}
            </DropdownMenuItem>,
          ])}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={!!chosen} onOpenChange={(o) => !o && !busy && setChosen(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{chosen?.label}</DialogTitle>
            <DialogDescription>
              {chosen?.count !== undefined
                ? `${chosen.count} ${chosen.count === 1 ? "row" : "rows"}, matching your current search and filters. `
                : "Everything you can see in this area. "}
              {NOTICE}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChosen(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => chosen && run(chosen)} disabled={busy}>
              {busy ? "Preparing…" : "Download CSV"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {picking && <ChooseRowsDialog item={picking} onClose={() => setPicking(null)} />}
    </>
  );
}

/** Lists the rows the screen is showing, nothing ticked, and exports only the ones ticked. */
function ChooseRowsDialog({ item, onClose }: { item: ExportItem; onClose: () => void }) {
  const spec = item.choose!;
  const fixed = "rows" in spec ? spec.rows : null;
  // Always called (hooks cannot be conditional); with fixed rows it just stays off.
  const { data, isLoading, error, refetch } = useList<{ id: string }>(
    "resource" in spec ? spec.resource : "contacts",
    { ...(spec.listParams ?? item.params), page: 1, pageSize: CHOOSE_LIMIT },
    !fixed,
  );
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const rows = fixed ? fixed.slice(0, CHOOSE_LIMIT) : (data?.data ?? []);
  const total = fixed ? fixed.length : data?.meta.total ?? 0;
  const show = (r: { id: string }): Shown => ("describe" in spec ? spec.describe(r as never) : (r as Row));
  const toggle = (id: string, on: boolean) =>
    setPicked((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  async function download() {
    setBusy(true);
    try {
      const encode = spec.encode ?? ((id: string) => id);
      const name = await downloadFile("GET", `/api/export/${item.entity}${qs({ ...item.params, [spec.param ?? "ids"]: [...picked].map(encode).join(",") })}`);
      toast.success(`Downloaded ${name}`);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose rows: {item.label}</DialogTitle>
          <DialogDescription>
            {spec.hint ?? "Tick the rows to include."} Nothing is ticked to begin with. {NOTICE}
          </DialogDescription>
        </DialogHeader>
        {!fixed && isLoading ? (
          <Skeleton className="h-40" />
        ) : !fixed && error ? (
          <ErrorState message={error?.message} onRetry={() => refetch()} />
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No rows match the current search and filters.</p>
        ) : (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {picked.size} of {rows.length} ticked
              </span>
              <span className="flex gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setPicked(new Set(rows.map((r) => r.id)))}>
                  Tick all shown
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setPicked(new Set())} disabled={picked.size === 0}>
                  Clear
                </Button>
              </span>
            </div>
            <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
              {rows.map((r) => {
                const d = show(r);
                return (
                  <li key={r.id}>
                    <label className="flex cursor-pointer items-start gap-3 px-3 py-2 text-sm hover:bg-muted/50">
                      <Checkbox className="mt-0.5" checked={picked.has(r.id)} onCheckedChange={(c) => toggle(r.id, c === true)} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{d.title}</span>
                        {d.detail && <span className="block truncate text-xs text-muted-foreground">{d.detail}</span>}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {total > rows.length && (
              <p className="text-xs text-muted-foreground">
                Showing the first {rows.length} of {total}. Use the search or filters on the page to narrow the list.
              </p>
            )}
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={download} disabled={busy || picked.size === 0}>
            {busy ? "Preparing…" : `Download CSV (${picked.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A one-click "Download PDF" button for a document (a deal statement or an invoice). */
export function PdfButton({ entity, id, label, className }: { entity: "deals" | "invoices"; id: string; label: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          toast.success(`Downloaded ${await downloadFile("GET", `/api/export/${entity}/${encodeURIComponent(id)}`)}`);
        } catch (e) {
          toast.error(errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Download /> {busy ? "Preparing…" : label}
    </Button>
  );
}

/**
 * Invoice PDF with a choice of lines. Every line starts ticked here (you are taking lines out of a document
 * you already have); the PDF then lists only the ticked ones and says it is a partial copy.
 */
export function InvoiceLinesButton({ invoiceId, items, currency, className }: { invoiceId: string; items: InvoiceItem[]; currency: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const toggle = (id: string, on: boolean) =>
    setPicked((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  async function download() {
    setBusy(true);
    try {
      const all = picked.size === items.length;
      const name = await downloadFile("GET", `/api/export/invoices/${encodeURIComponent(invoiceId)}${all ? "" : qs({ lines: [...picked].join(",") })}`);
      toast.success(`Downloaded ${name}`);
      setOpen(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={className}
        disabled={items.length === 0}
        onClick={() => {
          setPicked(new Set(items.map((i) => i.id)));
          setOpen(true);
        }}
      >
        <ListChecks /> Choose lines (PDF)
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Choose invoice lines</DialogTitle>
            <DialogDescription>Untick the lines to leave out. The PDF will list only the ticked lines, with their own subtotal and a note that it is a partial copy.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {picked.size} of {items.length} lines
            </span>
            <span className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setPicked(new Set(items.map((i) => i.id)))}>
                Tick all
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setPicked(new Set())} disabled={picked.size === 0}>
                Clear
              </Button>
            </span>
          </div>
          <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
            {items.map((i) => (
              <li key={i.id}>
                <label className="flex cursor-pointer items-start gap-3 px-3 py-2 text-sm hover:bg-muted/50">
                  <Checkbox className="mt-0.5" checked={picked.has(i.id)} onCheckedChange={(c) => toggle(i.id, c === true)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{i.description || i.style}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[i.ref, i.color, i.lengthInches ? `${i.lengthInches}"` : null, `${i.quantity} × ${money(i.unitPrice, currency)}`].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={download} disabled={busy || picked.size === 0}>
              {busy ? "Preparing…" : `Download PDF (${picked.size} ${picked.size === 1 ? "line" : "lines"})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
