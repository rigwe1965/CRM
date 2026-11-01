"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/common/page";
import { MAX_CONTACT_ROWS, readContactFile, type ContactImportResult } from "@/lib/client/contact-import";
import { request } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/hooks";
import { FormShell, useFormState } from "./form-kit";

type Outcome = { created: number; skippedCount: number; skipped: { row: number; name: string; reason: string }[] };

/** Brings a customer list (CSV or Excel) into the CRM. The file is read here in the browser; the server checks every row again. */
export function ImportContactsDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const form = useFormState();
  const fileInput = useRef<HTMLInputElement>(null);
  const [read, setRead] = useState<ContactImportResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [type, setType] = useState<"CUSTOMER" | "LEAD">("CUSTOMER");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function choose(file: File | undefined) {
    setRead(null);
    setOutcome(null);
    if (!file) return;
    try {
      setRead(await readContactFile(file));
      setFileName(file.name);
    } catch (e) {
      toast.error(errorMessage(e));
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function submit() {
    if (!read || read.rows.length === 0) return toast.error("Choose a file with at least one customer");
    setBusy(true);
    const ok = await form.run(async () => {
      const res = await request<{ data: Outcome }>("POST", "/api/contacts/import", { type, rows: read.rows });
      setOutcome(res.data);
    });
    setBusy(false);
    if (ok) await qc.invalidateQueries();
  }

  // After the import: what happened, and which rows were left out.
  if (outcome) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <div className="grid gap-3">
            <h2 className="text-lg font-semibold">{outcome.created} {outcome.created === 1 ? "contact" : "contacts"} imported</h2>
            {outcome.skippedCount > 0 && (
              <div className="space-y-2 text-sm">
                <p>{outcome.skippedCount} left out:</p>
                <ul className="max-h-48 space-y-1 overflow-auto rounded-md border p-2 text-xs">
                  {outcome.skipped.map((s) => (
                    <li key={s.row}>
                      Row {s.row}{s.name ? ` (${s.name})` : ""}: {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs text-muted-foreground">Imported customers are not signed up for emails or WhatsApp. Tick that on a contact once they have agreed.</p>
            <button type="button" className="justify-self-end rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" onClick={onClose}>
              Done
            </button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <FormShell
          title="Import customers"
          description="Choose a .csv or .xlsx file with a header row. We look for columns called Name (or First name and Last name), Email, Phone, City and Country."
          submitLabel="Import"
          pendingLabel="Importing…"
          pending={busy}
          formError={form.formError}
          onCancel={onClose}
          onSubmit={() => void submit()}
        >
          <FormField label="File">
            <Input ref={fileInput} type="file" accept=".csv,.txt,.xlsx" onChange={(e) => void choose(e.target.files?.[0])} />
          </FormField>
          <FormField label="Add them as">
            <Select value={type} onValueChange={(v) => setType(v as "CUSTOMER" | "LEAD")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CUSTOMER">Customers (people who already bought)</SelectItem>
                <SelectItem value="LEAD">Leads (people to follow up)</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          {read && (
            <div className="space-y-2 text-sm" aria-live="polite">
              <p>
                <span className="font-medium">{fileName}</span>: {read.rows.length} {read.rows.length === 1 ? "person" : "people"} found
                {read.skipped > 0 && `, ${read.skipped} rows without a name left out`}.
              </p>
              {read.extra > 0 && <p className="text-amber-700 dark:text-amber-400">Only the first {MAX_CONTACT_ROWS} are read; {read.extra} more rows were ignored. Import the rest in a second file.</p>}
              <ul className="divide-y rounded-md border text-xs">
                {read.rows.slice(0, 5).map((r, i) => (
                  <li key={i} className="flex justify-between gap-3 px-3 py-1.5">
                    <span className="truncate">{r.firstName} {r.lastName === "-" ? "" : r.lastName}</span>
                    <span className="truncate text-muted-foreground">{r.email || r.phone || "no email or phone"}</span>
                  </li>
                ))}
              </ul>
              {read.rows.length > 5 && <p className="text-xs text-muted-foreground">…and {read.rows.length - 5} more.</p>}
            </div>
          )}
        </FormShell>
      </DialogContent>
    </Dialog>
  );
}
