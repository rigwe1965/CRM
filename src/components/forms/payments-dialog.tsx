"use client";

import { useState } from "react";
import { addMonths, addWeeks, format, parseISO } from "date-fns";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, FormField } from "@/components/common/page";
import { PAYMENT_METHODS, paymentMethodLabel } from "@/lib/client/constants";
import { dateOnly, money, toDateInput } from "@/lib/client/format";
import { errorMessage, useAddPayment, useDeletePayment, usePayments, useSaveSchedule } from "@/lib/client/hooks";
import type { Deal, InstalmentStatus, PaymentMethod, PaymentsView } from "@/lib/client/types";
import { cn } from "@/lib/utils";
import { nullable, useFormState } from "./form-kit";

export function PaymentsDialog({ deal, onClose }: { deal: Deal | null; onClose: () => void }) {
  return (
    <Dialog open={!!deal} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">{deal && <PaymentsBody deal={deal} />}</DialogContent>
    </Dialog>
  );
}

const today = () => format(new Date(), "yyyy-MM-dd");

function PaymentsBody({ deal }: { deal: Deal }) {
  const { data, isLoading, error, refetch } = usePayments(deal.id);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Payments · {deal.title}</DialogTitle>
        <DialogDescription>Record money received and, if you like, agree due dates for instalments.</DialogDescription>
      </DialogHeader>
      {isLoading ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-16" />
          <Skeleton className="h-32" />
        </div>
      ) : error || !data ? (
        <ErrorState message={error?.message} onRetry={() => refetch()} />
      ) : (
        <PaymentsContent dealId={deal.id} view={data} />
      )}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "bad" | "good" }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums", tone === "bad" && "text-destructive", tone === "good" && "text-emerald-600 dark:text-emerald-400")}>{value}</p>
    </div>
  );
}

function PaymentsContent({ dealId, view }: { dealId: string; view: PaymentsView }) {
  const cur = (n: number) => money(n, view.currency);
  const { summary } = view;
  const settled = summary.balance <= 0;
  const del = useDeletePayment(dealId);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Deal amount" value={cur(view.dealAmount)} />
        <Stat label="Paid" value={cur(summary.paid)} tone="good" />
        <Stat label="Balance" value={cur(summary.balance)} tone={summary.overdue ? "bad" : undefined} />
      </div>
      <p className="text-sm text-muted-foreground">
        {settled
          ? "Fully paid."
          : summary.nextDue
            ? `Next due ${dateOnly(summary.nextDue.dueDate)}: ${cur(summary.nextDue.amount)}${summary.overdue ? " (overdue)" : ""}`
            : "No schedule set. Add one below if the customer is paying in instalments."}
      </p>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Payments received</h3>
        {view.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing received yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {view.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium tabular-nums">{cur(p.amount)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {dateOnly(p.paidAt)} · {paymentMethodLabel(p.method)}
                    {p.reference ? ` · ${p.reference}` : ""}
                    {p.note ? ` · ${p.note}` : ""} · by {p.recordedBy.name}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete payment of ${cur(p.amount)}`}
                  disabled={del.isPending}
                  onClick={() =>
                    del.mutate(p.id, {
                      onSuccess: () => toast.success("Payment removed"),
                      onError: (e) => toast.error(errorMessage(e)),
                    })
                  }
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {!settled && <AddPayment dealId={dealId} balance={summary.balance} />}
      </section>

      <ScheduleSection dealId={dealId} view={view} />
    </div>
  );
}

function AddPayment({ dealId, balance }: { dealId: string; balance: number }) {
  const add = useAddPayment(dealId);
  const form = useFormState();
  const [v, setV] = useState({ amount: "", paidAt: today(), method: "BANK_TRANSFER" as PaymentMethod, reference: "", note: "" });
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));

  return (
    <form
      noValidate
      className="space-y-3 rounded-md border bg-muted/30 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await form.run(() =>
          add.mutateAsync({
            amount: v.amount.trim() === "" ? undefined : Number(v.amount),
            paidAt: v.paidAt,
            method: v.method,
            reference: nullable(v.reference),
            note: nullable(v.note),
          }),
        );
        if (ok) {
          toast.success("Payment recorded");
          setV((s) => ({ ...s, amount: "", reference: "", note: "" }));
        }
      }}
    >
      <p className="text-sm font-medium">Record a payment</p>
      {form.formError && !form.err("amount") && <p role="alert" className="text-xs text-destructive">{form.formError}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Amount" error={form.err("amount")}>
          <Input type="number" min={0} step="0.01" value={v.amount} onChange={(e) => set("amount", e.target.value)} placeholder={String(balance)} />
        </FormField>
        <FormField label="Date received" error={form.err("paidAt")}>
          <Input type="date" value={v.paidAt} onChange={(e) => set("paidAt", e.target.value)} />
        </FormField>
        <FormField label="Method">
          <Select value={v.method} onValueChange={(m) => set("method", m as PaymentMethod)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_METHODS.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Reference (optional)" error={form.err("reference")}>
          <Input value={v.reference} onChange={(e) => set("reference", e.target.value)} placeholder="Transfer ID, Zelle name…" />
        </FormField>
        <FormField label="Note (optional)" error={form.err("note")}>
          <Input value={v.note} onChange={(e) => set("note", e.target.value)} />
        </FormField>
      </div>
      <Button type="submit" size="sm" disabled={add.isPending}>
        {add.isPending ? "Saving…" : "Add payment"}
      </Button>
    </form>
  );
}

function InstalmentBadge({ i }: { i: InstalmentStatus }) {
  if (i.covered >= i.amount) return <Badge variant="success">Paid</Badge>;
  if (i.overdue) return <Badge variant="destructive">Overdue</Badge>;
  if (i.covered > 0) return <Badge variant="warning">Part paid</Badge>;
  return <Badge variant="secondary">Upcoming</Badge>;
}

type Row = { key: number; dueDate: string; amount: string };
let rowKey = 0;

function ScheduleSection({ dealId, view }: { dealId: string; view: PaymentsView }) {
  const [editing, setEditing] = useState(false);
  const cur = (n: number) => money(n, view.currency);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Instalment schedule</h3>
        {!editing && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            {view.instalments.length ? "Change schedule" : "Set up schedule"}
          </Button>
        )}
      </div>
      {editing ? (
        <ScheduleEditor dealId={dealId} view={view} onDone={() => setEditing(false)} />
      ) : view.instalments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No schedule. Payments just reduce the balance.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {view.instalments.map((i, n) => (
            <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span>
                <span className="text-muted-foreground">#{n + 1}</span> · {dateOnly(i.dueDate)}
              </span>
              <span className="flex items-center gap-3">
                <span className="tabular-nums">{cur(i.amount)}</span>
                <InstalmentBadge i={i} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ScheduleEditor({ dealId, view, onDone }: { dealId: string; view: PaymentsView; onDone: () => void }) {
  const save = useSaveSchedule(dealId);
  const form = useFormState();
  const [rows, setRows] = useState<Row[]>(() =>
    view.instalments.map((i) => ({ key: rowKey++, dueDate: toDateInput(i.dueDate), amount: String(i.amount) })),
  );
  const [gen, setGen] = useState({ count: "3", first: today(), every: "month" as "month" | "week" });

  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  function generate() {
    const count = Math.max(1, Math.min(60, Math.floor(Number(gen.count) || 0)));
    if (!gen.first) return;
    const cents = Math.round(view.dealAmount * 100);
    const each = Math.floor(cents / count);
    const start = parseISO(gen.first);
    setRows(
      Array.from({ length: count }, (_, n) => ({
        key: rowKey++,
        dueDate: format(gen.every === "month" ? addMonths(start, n) : addWeeks(start, n), "yyyy-MM-dd"),
        // The last instalment absorbs any rounding so the total matches the deal.
        amount: ((n === count - 1 ? cents - each * (count - 1) : each) / 100).toFixed(2),
      })),
    );
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="grid items-end gap-3 sm:grid-cols-4">
        <FormField label="Split into">
          <Input type="number" min={1} max={60} value={gen.count} onChange={(e) => setGen((g) => ({ ...g, count: e.target.value }))} />
        </FormField>
        <FormField label="First due">
          <Input type="date" value={gen.first} onChange={(e) => setGen((g) => ({ ...g, first: e.target.value }))} />
        </FormField>
        <FormField label="Every">
          <Select value={gen.every} onValueChange={(e) => setGen((g) => ({ ...g, every: e as "month" | "week" }))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="month">Month</SelectItem>
              <SelectItem value="week">Week</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <Button type="button" variant="outline" onClick={generate}>
          Fill equal instalments
        </Button>
      </div>

      <div className="space-y-2">
        <Label>Instalments</Label>
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No instalments. Saving now clears the schedule.</p>}
        {rows.map((r, n) => (
          <div key={r.key} className="flex items-center gap-2">
            <span className="w-6 text-xs text-muted-foreground">#{n + 1}</span>
            <Input type="date" aria-label={`Instalment ${n + 1} due date`} value={r.dueDate} onChange={(e) => setRows((l) => l.map((x) => (x.key === r.key ? { ...x, dueDate: e.target.value } : x)))} />
            <Input type="number" min={0} step="0.01" aria-label={`Instalment ${n + 1} amount`} value={r.amount} onChange={(e) => setRows((l) => l.map((x) => (x.key === r.key ? { ...x, amount: e.target.value } : x)))} />
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove instalment ${n + 1}`} onClick={() => setRows((l) => l.filter((x) => x.key !== r.key))}>
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => setRows((l) => [...l, { key: rowKey++, dueDate: today(), amount: "" }])}>
          Add instalment
        </Button>
        <p className={cn("text-xs", total > view.dealAmount ? "text-destructive" : "text-muted-foreground")}>
          Total {money(total, view.currency)} of {money(view.dealAmount, view.currency)}
        </p>
        {form.formError && <p role="alert" className="text-xs text-destructive">{form.err("instalments") ?? form.formError}</p>}
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={save.isPending}
          onClick={async () => {
            const ok = await form.run(() =>
              save.mutateAsync(rows.map((r) => ({ dueDate: r.dueDate, amount: r.amount.trim() === "" ? NaN : Number(r.amount) }))),
            );
            if (ok) {
              toast.success("Schedule saved");
              onDone();
            }
          }}
        >
          {save.isPending ? "Saving…" : "Save schedule"}
        </Button>
      </div>
    </div>
  );
}
