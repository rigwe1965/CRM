"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/common/page";
import { errorMessage, useSetStockLevel } from "@/lib/client/hooks";
import type { StockRow } from "@/lib/client/types";

type Mode = "default" | "custom" | "never";

/** Admins choose when one stock row counts as low: the business default, its own number, or never. */
export function StockLevelDialog({ row, defaultThreshold, onClose }: { row: StockRow | null; defaultThreshold: number; onClose: () => void }) {
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">{row && <Body row={row} defaultThreshold={defaultThreshold} onDone={onClose} />}</DialogContent>
    </Dialog>
  );
}

function Body({ row, defaultThreshold, onDone }: { row: StockRow; defaultThreshold: number; onDone: () => void }) {
  const save = useSetStockLevel();
  const [mode, setMode] = useState<Mode>(row.threshold === null ? "default" : row.threshold === 0 ? "never" : "custom");
  const [level, setLevel] = useState(String(row.threshold || defaultThreshold || 3));
  const n = Number(level);
  const invalid = mode === "custom" && (!Number.isInteger(n) || n < 1 || n > 100_000);

  function submit() {
    const threshold = mode === "default" ? null : mode === "never" ? 0 : n;
    save.mutate(
      { product: row.product, color: row.color, lengthInches: row.lengthInches, threshold },
      { onSuccess: () => { toast.success("Alert level saved"); onDone(); }, onError: (e) => toast.error(errorMessage(e)) },
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Alert level · {row.product}</DialogTitle>
        <DialogDescription>
          {row.color || "No colour"} · {row.lengthInches ? `${row.lengthInches}"` : "no length"} · {row.onHand} on hand
        </DialogDescription>
      </DialogHeader>
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid) submit();
        }}
      >
        <FormField label="Warn me when this is low">
          <Select value={mode} onValueChange={(m) => setMode(m as Mode)}>
            <SelectTrigger aria-label="Alert level">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">{defaultThreshold > 0 ? `At the default (${defaultThreshold} or fewer)` : "Use the default (none set)"}</SelectItem>
              <SelectItem value="custom">At a number I choose</SelectItem>
              <SelectItem value="never">Never for this item</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        {mode === "custom" && (
          <FormField label="Low when this many pieces or fewer are left" error={invalid ? "Enter a whole number of 1 or more" : undefined}>
            <Input type="number" min={1} step={1} value={level} onChange={(e) => setLevel(e.target.value)} aria-invalid={invalid} />
          </FormField>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onDone} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending || invalid}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </>
  );
}
