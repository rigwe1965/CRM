"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/common/page";
import { ContactPicker, DealPicker, OrganizationPicker } from "@/components/common/pickers";
import {
  ACTIVITY_TYPES,
  DEAL_STAGES,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from "@/lib/client/constants";
import { money, toDateInput } from "@/lib/client/format";
import { useSave } from "@/lib/client/hooks";
import type { Activity, ActivityType, Deal, DealStage, Task, TaskPriority, TaskStatus } from "@/lib/client/types";
import { FormShell, Grid2, nullable, useFormState } from "./form-kit";

// ─── Deal ───────────────────────────────────────────────

type DealDefaults = { organizationId?: string | null; contactId?: string | null; stage?: DealStage };

export function DealDialog({
  open,
  onOpenChange,
  deal,
  defaults,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  deal?: Deal;
  defaults?: DealDefaults;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DealForm deal={deal} defaults={defaults} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function DealForm({ deal, defaults, onClose }: { deal?: Deal; defaults?: DealDefaults; onClose: () => void }) {
  const save = useSave<Deal>("deals", deal?.id);
  const form = useFormState();
  const initialStage = deal?.stage ?? defaults?.stage ?? "QUALIFICATION";
  const [v, setV] = useState({
    title: deal?.title ?? "",
    amount: deal ? String(deal.amount) : "",
    stage: initialStage as DealStage,
    probability: String(deal?.probability ?? DEAL_STAGES.find((s) => s.value === initialStage)!.probability),
    expectedCloseDate: toDateInput(deal?.expectedCloseDate),
    lostReason: deal?.lostReason ?? "",
    organizationId: (deal?.organizationId ?? defaults?.organizationId ?? null) as string | null,
    contactId: (deal?.contactId ?? defaults?.contactId ?? null) as string | null,
  });
  const [items, setItems] = useState<DealItemState[]>(() => initialItems(deal));
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));
  const filled = items.filter((i) => !isBlankItem(i));
  const itemsSum = filled.reduce((sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0);

  return (
    <FormShell
      title={deal ? "Edit deal" : "New deal"}
      description={deal ? undefined : "Track a sales opportunity through the pipeline."}
      submitLabel={deal ? "Save changes" : "Create deal"}
      pending={save.isPending}
      formError={form.formError}
      onCancel={onClose}
      onSubmit={async () => {
        const ok = await form.run(() =>
          save.mutateAsync({
            title: v.title,
            amount: filled.length ? undefined : v.amount.trim() === "" ? 0 : Number(v.amount),
            stage: v.stage,
            probability: v.probability.trim() === "" ? undefined : Number(v.probability),
            expectedCloseDate: v.expectedCloseDate || null,
            lostReason: v.stage === "CLOSED_LOST" ? nullable(v.lostReason) : undefined,
            // With items, the API sets the amount from them; sending [] on edit clears the lines.
            items: filled.length || deal ? filled.map(toPayload) : undefined,
            organizationId: v.organizationId,
            contactId: v.contactId,
          }),
        );
        if (ok) {
          toast.success(deal ? "Deal updated" : "Deal created");
          onClose();
        }
      }}
    >
      <FormField label="Deal name" error={form.err("title")}>
        <Input value={v.title} onChange={(e) => set("title", e.target.value)} aria-invalid={!!form.err("title")} autoFocus />
      </FormField>
      <Grid2>
        <FormField label="Amount (USD)" error={form.err("amount")} hint={filled.length ? "Total of the items below" : undefined}>
          {filled.length ? (
            <Input value={money(itemsSum, deal?.currency ?? "USD")} readOnly disabled />
          ) : (
            <Input type="number" min={0} step="0.01" value={v.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0" />
          )}
        </FormField>
        <FormField label="Expected close date" error={form.err("expectedCloseDate")}>
          <Input type="date" value={v.expectedCloseDate} onChange={(e) => set("expectedCloseDate", e.target.value)} />
        </FormField>
      </Grid2>
      <Grid2>
        <FormField label="Stage">
          <Select
            value={v.stage}
            onValueChange={(s) =>
              setV((x) => ({
                ...x,
                stage: s as DealStage,
                probability: String(DEAL_STAGES.find((d) => d.value === s)!.probability),
              }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEAL_STAGES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Win probability (%)" error={form.err("probability")}>
          <Input type="number" min={0} max={100} value={v.probability} onChange={(e) => set("probability", e.target.value)} />
        </FormField>
      </Grid2>
      {v.stage === "CLOSED_LOST" && (
        <FormField label="Lost reason" error={form.err("lostReason")}>
          <Textarea value={v.lostReason} onChange={(e) => set("lostReason", e.target.value)} rows={2} />
        </FormField>
      )}
      <DealItemsEditor items={items} setItems={setItems} err={form.err("items")} />
      <Grid2>
        <FormField label="Company" error={form.err("organizationId")}>
          <OrganizationPicker value={v.organizationId} onChange={(id) => set("organizationId", id)} placeholder="Select a company" fallback={deal?.organization} />
        </FormField>
        <FormField label="Contact" error={form.err("contactId")}>
          <ContactPicker value={v.contactId} onChange={(id) => set("contactId", id)} placeholder="Select a contact" fallback={deal?.contact} />
        </FormField>
      </Grid2>
    </FormShell>
  );
}

// ─── Deal items ─────────────────────────────────────────

type DealItemState = {
  key: number;
  productType: string;
  texture: string;
  lengthInches: string;
  color: string;
  laceType: string;
  quantity: string;
  unitPrice: string;
  note: string;
};

let itemKey = 0;
const blankItem = (): DealItemState => ({ key: itemKey++, productType: "", texture: "", lengthInches: "", color: "", laceType: "", quantity: "1", unitPrice: "", note: "" });
const isBlankItem = (i: DealItemState) => i.productType.trim() === "" && i.unitPrice.trim() === "";

/** Existing lines, else the old single-line hair fields turned into one line, else one empty row. */
function initialItems(deal?: Deal): DealItemState[] {
  if (deal?.items?.length) {
    return deal.items.map((i) => ({
      key: itemKey++,
      productType: i.productType,
      texture: i.texture ?? "",
      lengthInches: i.lengthInches ?? "",
      color: i.color ?? "",
      laceType: i.laceType ?? "",
      quantity: String(i.quantity),
      unitPrice: String(i.unitPrice),
      note: i.note ?? "",
    }));
  }
  if (deal?.productType) {
    const qty = deal.quantity ?? 1;
    return [
      {
        key: itemKey++,
        productType: deal.productType,
        texture: deal.texture ?? "",
        lengthInches: deal.lengthInches ?? "",
        color: deal.color ?? "",
        laceType: deal.laceType ?? "",
        quantity: String(qty),
        unitPrice: String(Math.round((deal.amount / qty) * 100) / 100),
        note: "",
      },
    ];
  }
  return [blankItem()];
}

const toPayload = (i: DealItemState) => ({
  productType: i.productType,
  texture: nullable(i.texture),
  lengthInches: nullable(i.lengthInches),
  color: nullable(i.color),
  laceType: nullable(i.laceType),
  quantity: i.quantity.trim() === "" ? undefined : Number(i.quantity),
  unitPrice: i.unitPrice.trim() === "" ? undefined : Number(i.unitPrice),
  note: nullable(i.note),
});

function DealItemsEditor({ items, setItems, err }: { items: DealItemState[]; setItems: React.Dispatch<React.SetStateAction<DealItemState[]>>; err?: string }) {
  const setItem = (key: number, patch: Partial<DealItemState>) => setItems((l) => l.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>What was bought</Label>
        <Button type="button" variant="outline" size="sm" onClick={() => setItems((l) => [...l, blankItem()])}>
          <Plus /> Add item
        </Button>
      </div>
      {err && <p role="alert" className="text-xs text-destructive">{err}</p>}
      <datalist id="hair-products">
        {["Bundles", "Closure", "Frontal", "Lace wig", "Full lace wig", "Headband wig", "Clip-ins", "Custom wig", "Bounce curl", "Pixie curl"].map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <datalist id="hair-textures">
        {["Straight", "Body wave", "Deep wave", "Loose wave", "Water wave", "Curly", "Kinky curly"].map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <datalist id="hair-laces">
        {["HD lace", "Transparent lace", "Swiss lace", "4x4 closure", "5x5 closure", "13x4 frontal", "13x6 frontal"].map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <div className="space-y-2">
        {items.map((i, n) => (
          <div key={i.key} className="grid grid-cols-2 gap-2 rounded-md border p-2 sm:grid-cols-12">
            <Input className="col-span-2 sm:col-span-4" list="hair-products" aria-label={`Item ${n + 1} product`} placeholder="Product (e.g. Bounce curl)" value={i.productType} onChange={(e) => setItem(i.key, { productType: e.target.value })} />
            <Input className="sm:col-span-3" list="hair-textures" aria-label={`Item ${n + 1} texture`} placeholder="Texture" value={i.texture} onChange={(e) => setItem(i.key, { texture: e.target.value })} />
            <Input className="sm:col-span-2" aria-label={`Item ${n + 1} length in inches`} placeholder="Length (in)" value={i.lengthInches} onChange={(e) => setItem(i.key, { lengthInches: e.target.value })} />
            <Input className="sm:col-span-2" aria-label={`Item ${n + 1} color`} placeholder="Color" value={i.color} onChange={(e) => setItem(i.key, { color: e.target.value })} />
            <Button type="button" variant="ghost" size="icon" className="justify-self-end sm:col-span-1" aria-label={`Remove item ${n + 1}`} disabled={items.length === 1} onClick={() => setItems((l) => l.filter((x) => x.key !== i.key))}>
              <Trash2 />
            </Button>
            <Input className="sm:col-span-3" list="hair-laces" aria-label={`Item ${n + 1} lace type`} placeholder="Lace type" value={i.laceType} onChange={(e) => setItem(i.key, { laceType: e.target.value })} />
            <Input className="sm:col-span-2" type="number" min={1} step={1} aria-label={`Item ${n + 1} quantity`} placeholder="Qty" value={i.quantity} onChange={(e) => setItem(i.key, { quantity: e.target.value })} />
            <Input className="sm:col-span-2" type="number" min={0} step="0.01" aria-label={`Item ${n + 1} price each`} placeholder="Price each" value={i.unitPrice} onChange={(e) => setItem(i.key, { unitPrice: e.target.value })} />
            <Input className="col-span-2 sm:col-span-5" aria-label={`Item ${n + 1} note`} placeholder="Note" value={i.note} onChange={(e) => setItem(i.key, { note: e.target.value })} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Task ───────────────────────────────────────────────

type TaskDefaults = { contactId?: string | null; dealId?: string | null };

export function TaskDialog({
  open,
  onOpenChange,
  task,
  defaults,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  task?: Task;
  defaults?: TaskDefaults;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <TaskForm task={task} defaults={defaults} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function TaskForm({ task, defaults, onClose }: { task?: Task; defaults?: TaskDefaults; onClose: () => void }) {
  const save = useSave<Task>("tasks", task?.id);
  const form = useFormState();
  const [v, setV] = useState({
    title: task?.title ?? "",
    description: task?.description ?? "",
    status: (task?.status ?? "TODO") as TaskStatus,
    priority: (task?.priority ?? "MEDIUM") as TaskPriority,
    dueDate: toDateInput(task?.dueDate),
    contactId: (task?.contactId ?? defaults?.contactId ?? null) as string | null,
    dealId: (task?.dealId ?? defaults?.dealId ?? null) as string | null,
  });
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));

  return (
    <FormShell
      title={task ? "Edit task" : "New task"}
      description={task ? undefined : "Something you or a teammate needs to do."}
      submitLabel={task ? "Save changes" : "Create task"}
      pending={save.isPending}
      formError={form.formError}
      onCancel={onClose}
      onSubmit={async () => {
        const ok = await form.run(() =>
          save.mutateAsync({
            title: v.title,
            description: nullable(v.description),
            status: v.status,
            priority: v.priority,
            dueDate: v.dueDate || null,
            contactId: v.contactId,
            dealId: v.dealId,
          }),
        );
        if (ok) {
          toast.success(task ? "Task updated" : "Task created");
          onClose();
        }
      }}
    >
      <FormField label="Title" error={form.err("title")}>
        <Input value={v.title} onChange={(e) => set("title", e.target.value)} aria-invalid={!!form.err("title")} autoFocus />
      </FormField>
      <FormField label="Description" error={form.err("description")}>
        <Textarea value={v.description} onChange={(e) => set("description", e.target.value)} rows={2} />
      </FormField>
      <Grid2>
        <FormField label="Due date" error={form.err("dueDate")}>
          <Input type="date" value={v.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
        </FormField>
        <FormField label="Priority">
          <Select value={v.priority} onValueChange={(p) => set("priority", p as TaskPriority)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_PRIORITIES.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </Grid2>
      {task && (
        <FormField label="Status">
          <Select value={v.status} onValueChange={(s) => set("status", s as TaskStatus)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      )}
      <Grid2>
        <FormField label="Related contact" error={form.err("contactId")}>
          <ContactPicker value={v.contactId} onChange={(id) => set("contactId", id)} placeholder="None" fallback={task?.contact} />
        </FormField>
        <FormField label="Related deal" error={form.err("dealId")}>
          <DealPicker value={v.dealId} onChange={(id) => set("dealId", id)} placeholder="None" fallback={task?.deal} />
        </FormField>
      </Grid2>
    </FormShell>
  );
}

// ─── Activity ───────────────────────────────────────────

type ActivityDefaults = { contactId?: string | null; dealId?: string | null; organizationId?: string | null };

export function ActivityDialog({
  open,
  onOpenChange,
  activity,
  defaults,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  activity?: Activity;
  defaults?: ActivityDefaults;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <ActivityForm activity={activity} defaults={defaults} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ActivityForm({
  activity,
  defaults,
  onClose,
}: {
  activity?: Activity;
  defaults?: ActivityDefaults;
  onClose: () => void;
}) {
  const save = useSave<Activity>("activities", activity?.id);
  const form = useFormState();
  const [v, setV] = useState({
    type: (activity?.type ?? "NOTE") as ActivityType,
    subject: activity?.subject ?? "",
    body: activity?.body ?? "",
    occurredAt: format(activity ? new Date(activity.occurredAt) : new Date(), "yyyy-MM-dd'T'HH:mm"),
    contactId: (activity?.contactId ?? defaults?.contactId ?? null) as string | null,
    dealId: (activity?.dealId ?? defaults?.dealId ?? null) as string | null,
    organizationId: (activity?.organizationId ?? defaults?.organizationId ?? null) as string | null,
  });
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));

  return (
    <FormShell
      title={activity ? "Edit activity" : "Log activity"}
      description={activity ? undefined : "Record a call, email, meeting or note."}
      submitLabel={activity ? "Save changes" : "Log activity"}
      pending={save.isPending}
      formError={form.formError}
      onCancel={onClose}
      onSubmit={async () => {
        const ok = await form.run(() =>
          save.mutateAsync({
            type: v.type,
            subject: v.subject,
            body: nullable(v.body),
            occurredAt: v.occurredAt ? new Date(v.occurredAt).toISOString() : undefined,
            contactId: v.contactId,
            dealId: v.dealId,
            organizationId: v.organizationId,
          }),
        );
        if (ok) {
          toast.success(activity ? "Activity updated" : "Activity logged");
          onClose();
        }
      }}
    >
      <Grid2>
        <FormField label="Type">
          <Select value={v.type} onValueChange={(t) => set("type", t as ActivityType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTIVITY_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="When" error={form.err("occurredAt")}>
          <Input type="datetime-local" value={v.occurredAt} onChange={(e) => set("occurredAt", e.target.value)} />
        </FormField>
      </Grid2>
      <FormField label="Subject" error={form.err("subject")}>
        <Input value={v.subject} onChange={(e) => set("subject", e.target.value)} aria-invalid={!!form.err("subject")} autoFocus />
      </FormField>
      <FormField label="Details" error={form.err("body")}>
        <Textarea value={v.body} onChange={(e) => set("body", e.target.value)} rows={3} />
      </FormField>
      <Grid2>
        <FormField label="Contact" error={form.err("contactId")}>
          <ContactPicker value={v.contactId} onChange={(id) => set("contactId", id)} placeholder="None" fallback={activity?.contact} />
        </FormField>
        <FormField label="Deal" error={form.err("dealId")}>
          <DealPicker value={v.dealId} onChange={(id) => set("dealId", id)} placeholder="None" fallback={activity?.deal} />
        </FormField>
      </Grid2>
      <FormField label="Company" error={form.err("organizationId")}>
        <OrganizationPicker value={v.organizationId} onChange={(id) => set("organizationId", id)} placeholder="None" fallback={activity?.organization} />
      </FormField>
    </FormShell>
  );
}
