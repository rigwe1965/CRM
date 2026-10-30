"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/common/page";
import { request } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/hooks";
import { cn } from "@/lib/utils";

export type ProposalCard = {
  id: string;
  kind: "TASK_CREATE" | "TASK_CHANGE" | "NOTE_CREATE" | "STAGE_CHANGE" | "MESSAGE_DRAFT" | "PAYMENT_RECORD" | "CONTACT_CREATE" | "DEAL_CREATE";
  status: "PENDING" | "APPLIED" | "DECLINED" | "EXPIRED" | "FAILED";
  preview: { title: string; lines: { label: string; value: string }[]; warning?: string; draft?: { text: string }; confirm?: { button: string; message: string } };
  approvable: boolean;
  editable: Record<string, string | null>;
  result: { href: string; entity: string } | null;
  failure: string | null;
  expiresAt: string;
};

const OPTIONS: Record<string, string[]> = {
  priority: ["LOW", "MEDIUM", "HIGH", "URGENT"],
  status: ["TODO", "IN_PROGRESS", "DONE", "CANCELLED"],
  method: ["BANK_TRANSFER", "CASH", "DIGITAL", "OTHER"],
  stage: ["QUALIFICATION", "DISCOVERY", "PROPOSAL", "NEGOTIATION", "CLOSED_WON", "CLOSED_LOST"],
};
const LABELS: Record<string, string> = {
  title: "Title", dueDate: "Due date", priority: "Priority", status: "Status", subject: "Subject", body: "Details", stage: "Stage", lostReason: "Reason",
  paidAt: "Date paid", method: "Method", reference: "Reference", note: "Notes", firstName: "First name", lastName: "Last name", email: "Email", phone: "Phone", city: "City", country: "Country", expectedCloseDate: "Expected close",
};
const DATE_FIELDS = new Set(["dueDate", "paidAt", "expectedCloseDate"]);
const nice = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
/** The server builds this link from record ids; anything that is not an in-app path is ignored. */
const safeHref = (h: string) => (h.startsWith("/") && !h.startsWith("//") ? h : "/");

const field = "h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function Card({ p, busy, onApprove, onDecline, onNavigate }: { p: ProposalCard; busy: boolean; onApprove: (edits: Record<string, string | null>) => void; onDecline: () => void; onNavigate: () => void }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(p.editable).map(([k, v]) => [k, v ?? ""])));
  const pending = p.status === "PENDING";
  const keys = Object.keys(p.editable);

  const edits = () => {
    const out: Record<string, string | null> = {};
    for (const k of keys) {
      const now = values[k] ?? "";
      const was = p.editable[k] ?? "";
      if (now === was) continue;
      if (now === "") {
        // A task being created can lose its due date; a change or a required field cannot be blanked.
        if (k === "dueDate" && p.kind === "TASK_CREATE") out[k] = null;
        continue;
      }
      out[k] = now;
    }
    return out;
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(p.preview.draft?.text ?? "");
      toast.success("Copied");
    } catch {
      toast.error("Could not copy. Select the text and copy it yourself.");
    }
  };

  return (
    <div className={cn("space-y-2 rounded-lg border bg-card p-3 text-sm", p.preview.confirm && "border-primary/60", !pending && "opacity-90")} data-testid="ivy-proposal">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{p.preview.title}</p>
        {p.status !== "PENDING" && (
          <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs", p.status === "APPLIED" ? "text-emerald-700" : p.status === "FAILED" ? "border-destructive/50 text-destructive" : "text-muted-foreground")}>
            {p.status === "APPLIED" ? <Check className="size-3" /> : p.status === "FAILED" ? <TriangleAlert className="size-3" /> : <X className="size-3" />}
            {p.status === "APPLIED" ? "Done" : p.status === "FAILED" ? "Not done" : p.status === "DECLINED" ? (p.approvable ? "Declined" : "Dismissed") : "Expired"}
          </span>
        )}
      </div>

      <dl className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1">
        {p.preview.lines.map((l, i) => (
          <div key={i} className="contents">
            <dt className="text-xs text-muted-foreground">{l.label}</dt>
            <dd className="break-words">{l.value}</dd>
          </div>
        ))}
      </dl>

      {p.preview.draft && <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-muted/50 p-2 font-sans text-sm">{p.preview.draft.text}</pre>}
      {p.preview.warning && (
        <p className="flex gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {p.preview.warning}
        </p>
      )}
      {p.failure && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">{p.failure}</p>}

      {pending && editing && (
        <div className="grid gap-2 rounded-md border bg-muted/30 p-2">
          {keys.map((k) => (
            <label key={k} className="grid gap-1 text-xs">
              <span className="text-muted-foreground">{LABELS[k] ?? k}</span>
              {OPTIONS[k] ? (
                <select className={field} value={values[k] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}>
                  {OPTIONS[k].map((o) => <option key={o} value={o}>{nice(o)}</option>)}
                </select>
              ) : k === "body" ? (
                <textarea className={cn(field, "h-20 py-1")} value={values[k] ?? ""} maxLength={2000} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))} />
              ) : (
                <Input type={DATE_FIELDS.has(k) ? "date" : "text"} className="h-8" value={values[k] ?? ""} maxLength={200} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))} />
              )}
            </label>
          ))}
        </div>
      )}

      {pending && p.approvable && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="sm" disabled={busy} onClick={() => (p.preview.confirm ? setConfirming(true) : onApprove(edits()))}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} {p.preview.confirm ? p.preview.confirm.button : "Approve"}
          </Button>
          {keys.length > 0 && <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing((e) => !e)}>{editing ? "Hide edit" : "Edit"}</Button>}
          <Button size="sm" variant="ghost" disabled={busy} onClick={onDecline}>Decline</Button>
        </div>
      )}
      {pending && !p.approvable && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="sm" onClick={() => void copy()}><Copy className="size-3.5" /> Copy</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onDecline}>Dismiss</Button>
        </div>
      )}
      {p.result && (
        <Link href={safeHref(p.result.href)} onClick={onNavigate} className="inline-block text-xs font-medium underline underline-offset-2">
          Open it
        </Link>
      )}
      {p.preview.confirm && (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title="Record this payment?"
          description={p.preview.confirm.message}
          confirmLabel={p.preview.confirm.button}
          pending={busy}
          onConfirm={() => {
            setConfirming(false);
            onApprove(edits());
          }}
        />
      )}
      {pending && <p className="text-[11px] text-muted-foreground">Nothing happens until you approve. This suggestion expires on {new Date(p.expiresAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.</p>}
    </div>
  );
}

/** The actions Ivy has proposed in this chat, as cards the person approves, edits or declines. Everything shown comes from the server's saved copy. */
export function ProposalCards({ conversationId, onNavigate }: { conversationId: string | undefined; onNavigate: () => void }) {
  const qc = useQueryClient();
  const key = ["ivy-proposals", conversationId];
  const { data } = useQuery({
    queryKey: key,
    queryFn: async () => (await request<{ data: ProposalCard[] }>("GET", `/api/assistant/proposals?conversationId=${encodeURIComponent(conversationId ?? "")}`)).data,
    enabled: !!conversationId,
  });
  const [busyId, setBusyId] = useState<string | null>(null);

  const approve = useMutation({
    mutationFn: ({ id, edits }: { id: string; edits: Record<string, string | null> }) => request<{ data: ProposalCard }>("POST", `/api/assistant/proposals/${id}/approve`, { edits }),
    onMutate: ({ id }) => setBusyId(id),
    onSuccess: (res) => {
      if (res.data.status === "APPLIED") toast.success("Done");
      else toast.error(res.data.failure ?? "That could not be done.");
      // What was changed shows up on the pages that list it.
      void qc.invalidateQueries();
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      void qc.invalidateQueries({ queryKey: key });
    },
    onSettled: () => setBusyId(null),
  });
  const decline = useMutation({
    mutationFn: (id: string) => request("POST", `/api/assistant/proposals/${id}/decline`, {}),
    onMutate: (id) => setBusyId(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => setBusyId(null),
  });

  if (!data?.length) return null;
  // "Approve all" leaves out anything with a warning (such as closing a deal) and every payment: those are approved one by one.
  const waiting = data.filter((p) => p.status === "PENDING" && p.approvable && !p.preview.warning && !p.preview.confirm);

  return (
    <section aria-label="Actions Ivy suggested" className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ivy suggests</h3>
        {waiting.length > 1 && (
          <Button
            size="sm"
            variant="outline"
            disabled={approve.isPending}
            onClick={async () => {
              // One at a time, so a failure on one never hides what happened to the others.
              for (const p of waiting) await approve.mutateAsync({ id: p.id, edits: {} }).catch(() => undefined);
            }}
          >
            Approve all ({waiting.length})
          </Button>
        )}
      </div>
      {data.map((p) => (
        <Card key={p.id} p={p} busy={busyId === p.id} onApprove={(edits) => approve.mutate({ id: p.id, edits })} onDecline={() => decline.mutate(p.id)} onNavigate={onNavigate} />
      ))}
    </section>
  );
}
