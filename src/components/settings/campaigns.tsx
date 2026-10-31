"use client";

import { useState } from "react";
import { Megaphone, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog, EmptyState, ErrorState, FormField, useDebounced } from "@/components/common/page";
import { FormShell, useFormState } from "@/components/forms/form-kit";
import { CONTACT_TYPES, LEAD_STATUSES } from "@/lib/client/constants";
import { dateOnly } from "@/lib/client/format";
import { errorMessage, useAudiencePreview, useCampaigns, useDeleteCampaign, useSaveCampaign, useTags, useWhatsappTemplates } from "@/lib/client/hooks";
import type { Campaign, CampaignAudience, CampaignStatus, ContactType, LeadStatus } from "@/lib/client/types";
import { renderBody } from "@/lib/whatsapp-template-slots";
import { cn } from "@/lib/utils";

const STATUS: Record<CampaignStatus, { label: string; variant: "secondary" | "warning" | "success" | "destructive" }> = {
  DRAFT: { label: "Draft", variant: "secondary" },
  QUEUED: { label: "Queued", variant: "warning" },
  SENDING: { label: "Sending", variant: "warning" },
  PAUSED: { label: "Paused", variant: "warning" },
  COMPLETED: { label: "Done", variant: "success" },
  STOPPED: { label: "Stopped", variant: "destructive" },
};

/** Blanks a campaign can fill: the customer's name, or text typed once for everyone. */
const CAMPAIGN_SOURCES = ["firstName", "fullName", "manual"];

const EMPTY: CampaignAudience = { tagIds: [], types: [], leadStatuses: [], sources: [], noOrderDays: null, paidInFull: false };

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
    >
      {children}
    </button>
  );
}

const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

function describe(a: CampaignAudience, tagNames: Map<string, string>) {
  const parts = [
    a.tagIds.length ? `tagged ${a.tagIds.map((id) => tagNames.get(id) ?? "?").join(" or ")}` : null,
    a.types.length ? a.types.map((t) => t.toLowerCase()).join(" / ") : null,
    a.leadStatuses.length ? `lead status ${a.leadStatuses.map((t) => t.toLowerCase()).join(" / ")}` : null,
    a.sources.length ? `from ${a.sources.join(", ")}` : null,
    a.noOrderDays ? `no order in ${a.noOrderDays} days` : null,
    a.paidInFull ? "paid in full" : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Everyone who agreed to WhatsApp";
}

function CampaignForm({ campaign, onClose }: { campaign?: Campaign; onClose: () => void }) {
  const save = useSaveCampaign(campaign?.id);
  const form = useFormState();
  const { data: templates } = useWhatsappTemplates();
  const { data: tags } = useTags();
  const [name, setName] = useState(campaign?.name ?? "");
  const [templateId, setTemplateId] = useState(campaign?.templateId ?? "");
  const [values, setValues] = useState<string[]>(campaign?.values ?? []);
  const [audience, setAudience] = useState<CampaignAudience>(campaign?.audience ?? EMPTY);
  const [sourcesText, setSourcesText] = useState((campaign?.audience.sources ?? []).join(", "));

  const sources = sourcesText.split(",").map((s) => s.trim()).filter(Boolean);
  const effective: CampaignAudience = { ...audience, sources };
  // Ask again only once the admin has paused typing.
  const settled = useDebounced(JSON.stringify(effective), 500);
  const preview = useAudiencePreview(JSON.parse(settled) as CampaignAudience);

  const usable = (templates ?? []).filter((t) => t.active && t.status === "APPROVED" && t.supported && t.slots.every((s) => CAMPAIGN_SOURCES.includes(s.source)));
  const template = usable.find((t) => t.id === templateId);
  const set = <K extends keyof CampaignAudience>(k: K, v: CampaignAudience[K]) => setAudience((a) => ({ ...a, [k]: v }));
  const p = preview.data;

  return (
    <FormShell
      title={campaign ? "Edit campaign" : "New campaign"}
      description="Choose an approved template and who should get it. Nothing is sent from here yet: this saves a draft."
      submitLabel="Save draft"
      pendingLabel="Saving…"
      pending={save.isPending}
      formError={form.formError}
      onCancel={onClose}
      onSubmit={async () => {
        const body = { name, templateId, audience: effective, values: (template?.slots ?? []).map((_, i) => values[i] ?? "") };
        if (await form.run(() => save.mutateAsync(body))) {
          toast.success("Draft saved");
          onClose();
        }
      }}
    >
      <FormField label="Name" error={form.err("name")}>
        <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. New stock, November" autoFocus />
      </FormField>

      <FormField label="Template" error={form.err("templateId")}>
        <Select value={templateId} onValueChange={(v) => { setTemplateId(v); setValues([]); }}>
          <SelectTrigger>
            <SelectValue placeholder={usable.length ? "Choose a template" : "No suitable template yet"} />
          </SelectTrigger>
          <SelectContent>
            {usable.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name} ({t.language})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <p className="-mt-2 text-xs text-muted-foreground">Only approved templates whose blanks are the customer&apos;s name or text typed here are listed.</p>
      {template?.slots.map((s, i) =>
        s.source === "manual" ? (
          <FormField key={i} label={s.label} error={form.err(`values.${i}`)}>
            <Input value={values[i] ?? ""} maxLength={200} onChange={(e) => setValues((all) => Object.assign([...all], { [i]: e.target.value }))} />
          </FormField>
        ) : null,
      )}
      {template && (
        <p className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm">
          {renderBody(template.body, template.slots.map((s, i) => (s.source === "firstName" ? "[First name]" : s.source === "fullName" ? "[Full name]" : values[i]?.trim() || `[${s.label}]`)))}
        </p>
      )}

      <fieldset className="space-y-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Who gets it</legend>
        <p className="text-xs text-muted-foreground">Only customers who agreed to WhatsApp and have a WhatsApp-ready number are ever included. Leave a filter empty to not restrict by it.</p>
        {(tags ?? []).length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium">Tagged (any of)</p>
            <div className="flex flex-wrap gap-2">
              {tags!.map((t) => (
                <Chip key={t.id} on={audience.tagIds.includes(t.id)} onClick={() => set("tagIds", toggle(audience.tagIds, t.id))}>
                  {t.name}
                </Chip>
              ))}
            </div>
          </div>
        )}
        <div className="space-y-1">
          <p className="text-xs font-medium">Contact type</p>
          <div className="flex flex-wrap gap-2">
            {CONTACT_TYPES.map((t) => (
              <Chip key={t.value} on={audience.types.includes(t.value)} onClick={() => set("types", toggle<ContactType>(audience.types, t.value))}>
                {t.label}
              </Chip>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium">Lead status</p>
          <div className="flex flex-wrap gap-2">
            {LEAD_STATUSES.map((t) => (
              <Chip key={t.value} on={audience.leadStatuses.includes(t.value)} onClick={() => set("leadStatuses", toggle<LeadStatus>(audience.leadStatuses, t.value))}>
                {t.label}
              </Chip>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Source (comma separated)" error={form.err("audience")}>
            <Input value={sourcesText} onChange={(e) => setSourcesText(e.target.value)} placeholder="Instagram, Referral" />
          </FormField>
          <FormField label="No order in the last … days">
            <Input
              type="number"
              min={1}
              max={3650}
              value={audience.noOrderDays ?? ""}
              onChange={(e) => set("noOrderDays", e.target.value === "" ? null : Math.max(1, Math.min(3650, Math.floor(Number(e.target.value) || 1))))}
              placeholder="e.g. 90"
            />
          </FormField>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={audience.paidInFull} onCheckedChange={(c) => set("paidInFull", c === true)} />
          Only customers whose won orders are all paid in full
        </label>

        <div role="status" className="rounded-md border bg-muted/40 p-3 text-sm">
          {!p ? (
            <Skeleton className="h-10" />
          ) : (
            <>
              <p className="font-medium">
                {p.total} {p.total === 1 ? "customer" : "customers"} would get this
                {preview.isFetching ? " …" : ""}
              </p>
              {p.notReachable > 0 && <p className="text-xs text-muted-foreground">{p.notReachable} more match but can&apos;t be messaged (no WhatsApp tick or no WhatsApp-ready number).</p>}
              {p.tooLarge && <p className="mt-1 text-xs font-medium text-destructive">That is more than the {p.max} a single campaign may reach. Narrow the filters.</p>}
              {p.sample.length > 0 && <p className="mt-1 text-xs text-muted-foreground">e.g. {p.sample.map((c) => c.name).join(", ")}{p.total > p.sample.length ? " …" : ""}</p>}
            </>
          )}
        </div>
      </fieldset>
    </FormShell>
  );
}

export function CampaignsCard() {
  const { data, isLoading, error, refetch } = useCampaigns();
  const { data: tags } = useTags();
  const remove = useDeleteCampaign();
  const [editing, setEditing] = useState<Campaign | "new" | null>(null);
  const [deleting, setDeleting] = useState<Campaign | null>(null);
  const tagNames = new Map((tags ?? []).map((t) => [t.id, t.name]));

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Campaigns</CardTitle>
          <CardDescription>
            Send one approved WhatsApp template to a group of customers who agreed to WhatsApp. For now you can build the audience and save a draft; sending comes next. Each message costs money with Meta, so the audience is previewed before anything is sent.
          </CardDescription>
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus /> New campaign
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : error || !data ? (
          <ErrorState message={error?.message} onRetry={() => refetch()} />
        ) : data.length === 0 ? (
          <EmptyState icon={Megaphone} title="No campaigns yet" description="Create a draft to choose a template and see who it would reach." />
        ) : (
          <ul className="divide-y rounded-md border">
            {data.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-3 text-sm">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">
                    {c.name} <Badge variant={STATUS[c.status].variant}>{STATUS[c.status].label}</Badge>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.templateName} ({c.templateLanguage}) · {describe(c.audience, tagNames)} · {dateOnly(c.createdAt)} by {c.createdBy.name}
                  </p>
                </div>
                {c.status === "DRAFT" && (
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}>
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={`Delete ${c.name}`} onClick={() => setDeleting(c)}>
                      <Trash2 />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
            <CampaignForm campaign={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />
          </DialogContent>
        </Dialog>
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this draft?"
        description={deleting ? `“${deleting.name}” will be deleted for good. Nothing has been sent.` : ""}
        confirmLabel="Delete"
        pending={remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting.id, {
            onSuccess: () => { toast.success("Draft deleted"); setDeleting(null); },
            onError: (e) => toast.error(errorMessage(e)),
          });
        }}
      />
    </Card>
  );
}
