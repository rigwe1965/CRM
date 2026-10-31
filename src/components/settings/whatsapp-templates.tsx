"use client";

import { useState } from "react";
import { MessageCircle, RefreshCw, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, FormField } from "@/components/common/page";
import { FormShell, useFormState } from "@/components/forms/form-kit";
import { errorMessage, useSyncWhatsappTemplates, useUpdateWhatsappTemplate, useWhatsappTemplates } from "@/lib/client/hooks";
import type { WhatsappTemplate, WhatsappTemplateSlot } from "@/lib/client/types";
import { renderBody, SLOT_SOURCES } from "@/lib/whatsapp-template-slots";

const STATUS: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "secondary" }> = {
  APPROVED: { label: "Approved", variant: "success" },
  PENDING: { label: "Waiting for Meta", variant: "warning" },
  IN_APPEAL: { label: "In appeal", variant: "warning" },
  REJECTED: { label: "Rejected", variant: "destructive" },
  PAUSED: { label: "Paused by Meta", variant: "destructive" },
  DISABLED: { label: "Disabled by Meta", variant: "destructive" },
  REMOVED: { label: "No longer in Meta", variant: "secondary" },
};

/** Says where each blank in the template gets its value from when a message is sent. */
function SlotsForm({ template, onClose }: { template: WhatsappTemplate; onClose: () => void }) {
  const save = useUpdateWhatsappTemplate(template.id);
  const form = useFormState();
  const [slots, setSlots] = useState<WhatsappTemplateSlot[]>(template.slots);
  const sample = slots.map((s) => `[${s.label}]`);

  return (
    <FormShell
      title={`Blanks in ${template.name}`}
      description="For each {{number}} in the message, name it and choose where its value comes from."
      submitLabel="Save"
      pending={save.isPending}
      formError={form.formError}
      onCancel={onClose}
      onSubmit={async () => {
        if (await form.run(() => save.mutateAsync({ slots }))) {
          toast.success("Saved");
          onClose();
        }
      }}
    >
      <p className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm">{renderBody(template.body, sample)}</p>
      {slots.map((s, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-2">
          <FormField label={`{{${i + 1}}} name`} error={form.err("slots")}>
            <Input value={s.label} maxLength={40} onChange={(e) => setSlots((all) => all.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          </FormField>
          <FormField label="Value comes from">
            <Select value={s.source} onValueChange={(v) => setSlots((all) => all.map((x, j) => (j === i ? { ...x, source: v as WhatsappTemplateSlot["source"] } : x)))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SLOT_SOURCES).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>
      ))}
    </FormShell>
  );
}

function Row({ t, onEdit }: { t: WhatsappTemplate; onEdit: () => void }) {
  const update = useUpdateWhatsappTemplate(t.id);
  const status = STATUS[t.status] ?? { label: t.status, variant: "secondary" as const };
  const canSwitch = t.active || (t.status === "APPROVED" && t.supported);
  return (
    <li className="flex items-start justify-between gap-3 px-5 py-3">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{t.name}</p>
          <Badge variant={status.variant}>{status.label}</Badge>
          <span className="text-xs text-muted-foreground">{t.language}</span>
          {!t.supported && <Badge variant="secondary">Not sendable yet</Badge>}
        </div>
        <p className="line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground">{t.body}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="icon" aria-label={`Set the blanks of ${t.name}`} disabled={t.slots.length === 0} onClick={onEdit}>
          <SlidersHorizontal />
        </Button>
        <Button
          variant={t.active ? "default" : "outline"}
          size="sm"
          disabled={!canSwitch || update.isPending}
          onClick={() => update.mutate({ active: !t.active }, { onError: (e) => toast.error(errorMessage(e)) })}
        >
          {t.active ? "On" : "Off"}
        </Button>
      </div>
    </li>
  );
}

export function WhatsappTemplatesCard() {
  const { data, isLoading, error, refetch } = useWhatsappTemplates();
  const sync = useSyncWhatsappTemplates();
  const [editing, setEditing] = useState<WhatsappTemplate | null>(null);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle>WhatsApp templates</CardTitle>
          <CardDescription>
            WhatsApp only lets a business start a conversation, or write after 24 hours, with a template Meta has approved. Create them in Meta&apos;s WhatsApp Manager, then copy them here. Switch on the ones your team may use.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          disabled={sync.isPending}
          onClick={() =>
            sync.mutate(undefined, {
              onSuccess: (r) => toast.success(`Copied from Meta: ${r.created} new, ${r.updated} updated, ${r.removed} no longer there`),
              onError: (e) => toast.error(errorMessage(e)),
            })
          }
        >
          <RefreshCw className={sync.isPending ? "animate-spin" : undefined} /> {sync.isPending ? "Copying…" : "Refresh from Meta"}
        </Button>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        {isLoading ? (
          <Skeleton className="mx-5 h-24" />
        ) : error || !data ? (
          <ErrorState message={error?.message} onRetry={() => refetch()} />
        ) : data.length === 0 ? (
          <EmptyState
            icon={MessageCircle}
            title="No WhatsApp templates yet"
            description="Set up WhatsApp and add your Business Account ID under Integrations, create your templates in Meta, then press Refresh from Meta."
            className="py-10"
          />
        ) : (
          <ul className="divide-y">
            {data.map((t) => (
              <Row key={t.id} t={t} onEdit={() => setEditing(t)} />
            ))}
          </ul>
        )}
      </CardContent>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>{editing && <SlotsForm template={editing} onClose={() => setEditing(null)} />}</DialogContent>
      </Dialog>
    </Card>
  );
}
