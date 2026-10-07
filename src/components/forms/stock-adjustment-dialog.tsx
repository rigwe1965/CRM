"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog, FormField } from "@/components/common/page";
import { dateOnly } from "@/lib/client/format";
import { errorMessage, useRemove, useSave } from "@/lib/client/hooks";
import type { StockAdjustment, StockRow } from "@/lib/client/types";
import { cn } from "@/lib/utils";
import { nullable, useFormState } from "./form-kit";

const REASONS = ["Recount", "Damaged", "Lost", "Sample", "Returned", "Opening stock", "Other"];

/** `row` set: adjust that stock row. `row` null with `open`: add stock for a new product. */
export function StockAdjustmentDialog({ open, row, onClose }: { open: boolean; row: StockRow | null; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">{open && <Body row={row} onDone={onClose} />}</DialogContent>
    </Dialog>
  );
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

function Body({ row, onDone }: { row: StockRow | null; onDone: () => void }) {
  const form = useFormState();
  const create = useSave("stock/adjustments");
  const [product, setProduct] = useState("");
  const [color, setColor] = useState("");
  const [length, setLength] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState(row ? "Recount" : "Opening stock");
  const [other, setOther] = useState("");
  const [note, setNote] = useState("");

  const finalReason = reason === "Other" ? other.trim() : reason;
  const qty = Number(quantity);

  async function submit() {
    if (!quantity.trim() || !Number.isInteger(qty) || qty === 0) {
      form.run(() => Promise.reject(new Error("Enter a whole number of pieces, like -2 or 5.")));
      return;
    }
    const ok = await form.run(() =>
      create.mutateAsync({
        product: row ? row.product : product,
        color: row ? row.color : color,
        lengthInches: row ? row.lengthInches : length.trim() ? Number(length) : null,
        quantity: qty,
        reason: finalReason,
        note: nullable(note),
      }),
    );
    if (ok) {
      toast.success("Adjustment saved");
      setQuantity("");
      setNote("");
      if (!row) onDone();
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{row ? `Adjust stock · ${row.product}` : "Add stock"}</DialogTitle>
        <DialogDescription>
          {row
            ? `${row.color || "No colour"} · ${row.lengthInches ? `${row.lengthInches}"` : "no length"} · ${row.onHand} on hand (bought ${row.bought}, sold ${row.sold}, adjusted ${signed(row.adjusted)})`
            : "Enter stock that isn't on a supplier invoice, such as opening stock."}
        </DialogDescription>
      </DialogHeader>

      {row && row.adjustments.length > 0 && (
        <section aria-label="Existing adjustments" className="space-y-2">
          <h3 className="text-sm font-medium">Adjustments</h3>
          <ul className="divide-y rounded-md border">
            {row.adjustments.map((a) => (
              <AdjustmentItem key={a.id} a={a} />
            ))}
          </ul>
        </section>
      )}

      <form
        noValidate
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h3 className="text-sm font-medium">{row ? "New adjustment" : "Product"}</h3>
        {form.formError && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {form.formError}
          </p>
        )}
        {!row && (
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Product" error={form.err("product")}>
              <Input value={product} onChange={(e) => setProduct(e.target.value)} aria-invalid={!!form.err("product")} />
            </FormField>
            <FormField label="Colour" error={form.err("color")}>
              <Input value={color} onChange={(e) => setColor(e.target.value)} />
            </FormField>
            <FormField label="Length (inches)" error={form.err("lengthInches")}>
              <Input type="number" min={1} value={length} onChange={(e) => setLength(e.target.value)} />
            </FormField>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Pieces (+ add, − remove)" error={form.err("quantity")}>
            <Input type="number" step={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="-2" aria-invalid={!!form.err("quantity")} />
          </FormField>
          <FormField label="Reason" error={form.err("reason")}>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger aria-label="Reason">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>
        {reason === "Other" && (
          <FormField label="Describe the reason">
            <Input value={other} onChange={(e) => setOther(e.target.value)} />
          </FormField>
        )}
        <FormField label="Note (optional)" error={form.err("note")}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onDone} disabled={create.isPending}>
            Close
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Saving…" : "Save adjustment"}
          </Button>
        </div>
      </form>
    </>
  );
}

function AdjustmentItem({ a }: { a: StockAdjustment }) {
  const save = useSave("stock/adjustments", a.id);
  const remove = useRemove("stock/adjustments");
  const form = useFormState();
  const [editing, setEditing] = useState(false);
  const [quantity, setQuantity] = useState(String(a.quantity));
  const [reason, setReason] = useState(a.reason);
  const [note, setNote] = useState(a.note ?? "");
  const [confirming, setConfirming] = useState(false);

  if (editing) {
    return (
      <li className="grid gap-2 p-3">
        {form.formError && (
          <p role="alert" className="text-sm text-destructive">
            {form.formError}
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-[6rem_1fr_1fr]">
          <Input type="number" step={1} aria-label="Pieces" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          <Input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Input aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={save.isPending}
            onClick={async () => {
              const ok = await form.run(() => save.mutateAsync({ quantity: Number(quantity), reason, note: nullable(note) }));
              if (ok) {
                toast.success("Adjustment updated");
                setEditing(false);
              }
            }}
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 p-3 text-sm">
      <span className={cn("w-12 shrink-0 font-semibold tabular-nums", a.quantity < 0 && "text-destructive")}>{signed(a.quantity)}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate">{a.reason}</p>
        <p className="truncate text-xs text-muted-foreground">
          {dateOnly(a.createdAt)}
          {a.note ? ` · ${a.note}` : ""}
        </p>
      </div>
      <Button type="button" variant="ghost" size="icon" aria-label={`Edit adjustment ${signed(a.quantity)}`} onClick={() => setEditing(true)}>
        <Pencil />
      </Button>
      <Button type="button" variant="ghost" size="icon" aria-label={`Delete adjustment ${signed(a.quantity)}`} onClick={() => setConfirming(true)}>
        <Trash2 />
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete this adjustment?"
        description={`The ${signed(a.quantity)} piece correction (${a.reason}) will be removed and on-hand stock recalculated.`}
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(a.id, {
            onSuccess: () => {
              setConfirming(false);
              toast.success("Adjustment removed");
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </li>
  );
}
