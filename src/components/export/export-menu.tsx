"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { qs, type Query } from "@/lib/client/api";
import { downloadFile } from "@/lib/client/download";
import { errorMessage } from "@/lib/client/hooks";

export type ExportItem = {
  label: string;
  /** The name in /api/export/<entity>. */
  entity: string;
  /** The same filters the screen is showing, so the file matches what you see. */
  params?: Query;
  /** Rows the file will have, when the screen knows. */
  count?: number;
};

const NOTICE =
  "The file may contain customer names and payment amounts. Keep it private and delete it when you no longer need it. This export is recorded in the audit log.";

/**
 * "Export" button with a menu of the files this screen can produce. Choosing one asks for confirmation
 * (with the row count when known) and then downloads it. Exports are limited per person, so the dialog
 * does not offer a way to repeat one by accident.
 */
export function ExportMenu({ items }: { items: ExportItem[] }) {
  const [chosen, setChosen] = useState<ExportItem | null>(null);
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
          {items.map((item) => (
            <DropdownMenuItem key={item.entity} onSelect={() => setChosen(item)}>
              {item.label}
            </DropdownMenuItem>
          ))}
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
    </>
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
