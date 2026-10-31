"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Megaphone, Pencil, Play, Plus, Send, Square, Trash2 } from "lucide-react";
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
import { errorMessage, stepCampaign, useAudiencePreview, useCampaigns, useDeleteCampaign, useResumeCampaign, useSaveCampaign, useStartCampaign, useStopCampaign, useTags, useTestCampaign, useWhatsappTemplates } from "@/lib/client/hooks";
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

const PAUSE_TEXT: Record<NonNullable<Campaign["pausedReason"]>, string> = {
  DAILY_LIMIT: "Today's WhatsApp limit for your plan is used. It carries on tomorrow.",
  META_RATE_LIMIT: "Meta asked us to slow down. Wait a few minutes, then press Resume.",
  TOO_MANY_FAILURES: "Several messages in a row failed, so it paused. Check the reasons, then press Resume.",
  TEMPLATE_UNAVAILABLE: "The template is no longer approved and switched on, or WhatsApp is not set up. Fix that, then press Resume.",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * While a campaign is SENDING and this page is open, asks the server for the next batch again and again. Closing the page
 * is safe: the server's daily job carries on whatever is left.
 */
function useCampaignDriver(c: Campaign) {
  const qc = useQueryClient();
  useEffect(() => {
    if (c.status !== "SENDING") return;
    let alive = true;
    (async () => {
      while (alive) {
        try {
          const r = await stepCampaign(c.id);
          await qc.invalidateQueries({ queryKey: ["campaigns"] });
          if (r.status !== "SENDING") {
            if (r.status === "COMPLETED") toast.success(`“${c.name}” has finished sending`);
            else if (r.pausedReason) toast.warning(PAUSE_TEXT[r.pausedReason]);
            break;
          }
          await sleep(r.busy ? 3000 : 700);
        } catch (e) {
          toast.error(errorMessage(e));
          await qc.invalidateQueries({ queryKey: ["campaigns"] });
          break;
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [c.id, c.status, c.name, qc]);
}

/** Test send, then a last look at the audience, then start. Nothing goes to a customer until "Start sending". */
function SendDialog({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const [phone, setPhone] = useState("");
  const [ack, setAck] = useState(false);
  const test = useTestCampaign(campaign.id);
  const start = useStartCampaign(campaign.id);
  const { data: templates } = useWhatsappTemplates();
  const preview = useAudiencePreview(campaign.audience);
  const category = templates?.find((t) => t.id === campaign.templateId)?.category;
  const p = preview.data;
  const tested = !!campaign.testedAt;
  const ready = tested && ack && !!p && p.total > 0 && !p.tooLarge && !preview.isFetching;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Send “{campaign.name}”</h2>
        <p className="text-sm text-muted-foreground">Template {campaign.templateName} ({campaign.templateLanguage}).</p>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">1. Send yourself a test</h3>
        <p className="text-xs text-muted-foreground">You get the real message, filled in with your name. It counts toward today&apos;s WhatsApp limit and costs the same as one message.</p>
        <div className="flex gap-2">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+2348012345678" aria-label="Your WhatsApp number" />
          <Button
            type="button"
            variant="outline"
            disabled={!phone.trim() || test.isPending}
            onClick={() => test.mutate(phone, { onSuccess: (r) => toast.success(`Test sent to ${r.sentTo}`), onError: (e) => toast.error(errorMessage(e)) })}
          >
            <Send /> {test.isPending ? "Sending…" : tested ? "Send again" : "Send test"}
          </Button>
        </div>
        {tested && <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Tested. Check your phone to make sure it reads right.</p>}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">2. Check who gets it</h3>
        <div role="status" className="rounded-md border bg-muted/40 p-3 text-sm">
          {!p ? (
            <Skeleton className="h-8" />
          ) : (
            <>
              <p className="font-medium">
                {p.total} {p.total === 1 ? "customer" : "customers"} will get this message
              </p>
              {p.sample.length > 0 && <p className="text-xs text-muted-foreground">e.g. {p.sample.map((c) => c.name).join(", ")}{p.total > p.sample.length ? " …" : ""}</p>}
              {p.tooLarge && <p className="mt-1 text-xs font-medium text-destructive">More than the {p.max} one campaign may reach. Narrow the audience.</p>}
              {p.total === 0 && <p className="mt-1 text-xs font-medium text-destructive">Nobody matches, so there is nothing to send.</p>}
            </>
          )}
        </div>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox className="mt-0.5" checked={ack} onCheckedChange={(c) => setAck(c === true)} />
          <span>
            I understand Meta charges for every message{category ? ` (this template is in the ${category.toLowerCase()} category)` : ""}, that messages already sent can&apos;t be recalled, and that I can stop the rest at any time.
          </span>
        </label>
      </section>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={start.isPending}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={!ready || start.isPending}
          onClick={() =>
            start.mutate(p!.total, {
              onSuccess: () => {
                toast.success("Sending has started");
                onClose();
              },
              onError: (e) => toast.error(errorMessage(e)),
            })
          }
        >
          <Play /> {start.isPending ? "Starting…" : `Start sending to ${p?.total ?? "…"}`}
        </Button>
      </div>
    </div>
  );
}

/** Progress and the Stop / Resume buttons of a running, paused or finished campaign. */
function RunningControls({ c }: { c: Campaign }) {
  useCampaignDriver(c);
  const stop = useStopCampaign(c.id);
  const resume = useResumeCampaign(c.id);
  const [confirmStop, setConfirmStop] = useState(false);
  const n = (k: string) => c.counts?.[k] ?? 0;
  const total = c.audienceSize ?? Object.values(c.counts ?? {}).reduce((s, x) => s + x, 0);
  const done = n("SENT") + n("DELIVERED") + n("READ") + n("FAILED") + n("SKIPPED");
  const live = c.status === "SENDING" || c.status === "PAUSED";

  return (
    <div className="mt-2 space-y-1.5">
      {total > 0 && (
        <div className="space-y-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
            <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, Math.round((done / total) * 100))}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">
            {n("SENT") + n("DELIVERED") + n("READ")} of {total} sent{n("FAILED") ? ` · ${n("FAILED")} failed` : ""}{n("SKIPPED") ? ` · ${n("SKIPPED")} skipped` : ""}
          </p>
        </div>
      )}
      {c.status === "SENDING" && <p className="text-xs text-muted-foreground">Sending while this page is open. If you close it, the daily job carries on.</p>}
      {c.status === "PAUSED" && c.pausedReason && <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">{PAUSE_TEXT[c.pausedReason]}</p>}
      {live && (
        <div className="flex gap-2">
          {c.status === "PAUSED" && (
            <Button type="button" size="sm" variant="outline" disabled={resume.isPending} onClick={() => resume.mutate(undefined, { onError: (e) => toast.error(errorMessage(e)) })}>
              <Play /> Resume
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setConfirmStop(true)}>
            <Square /> Stop
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title="Stop this campaign?"
        description="Nobody else will be messaged. Messages already sent can't be recalled, and a stopped campaign can't be restarted."
        confirmLabel="Stop campaign"
        pending={stop.isPending}
        onConfirm={() =>
          stop.mutate(undefined, {
            onSuccess: () => { toast.success("Campaign stopped"); setConfirmStop(false); },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </div>
  );
}

export function CampaignsCard() {
  const { data, isLoading, error, refetch } = useCampaigns();
  const { data: tags } = useTags();
  const remove = useDeleteCampaign();
  const [editing, setEditing] = useState<Campaign | "new" | null>(null);
  const [deleting, setDeleting] = useState<Campaign | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const tagNames = new Map((tags ?? []).map((t) => [t.id, t.name]));

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Campaigns</CardTitle>
          <CardDescription>
            Send one approved WhatsApp template to a group of customers who agreed to WhatsApp. You build the audience, send yourself a test, check the numbers and then start. Each message costs money with Meta, and you can stop at any time.
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
                  {c.status !== "DRAFT" && <RunningControls c={c} />}
                </div>
                {c.status === "DRAFT" && (
                  <div className="flex shrink-0 gap-1">
                    <Button variant="outline" size="sm" onClick={() => setSendingId(c.id)}>
                      <Send /> Send…
                    </Button>
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
      {sendingId && data?.find((c) => c.id === sendingId) && (
        <Dialog open onOpenChange={(o) => !o && setSendingId(null)}>
          <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
            <SendDialog campaign={data.find((c) => c.id === sendingId)!} onClose={() => setSendingId(null)} />
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
