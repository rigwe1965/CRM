"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/common/page";
import { DEAL_STAGES, TASK_PRIORITIES } from "@/lib/client/constants";
import { errorMessage, useAutomations, useSaveAutomations, useSendSampleEmail, useWhatsappTemplates } from "@/lib/client/hooks";
import type { AutomationsView, InstalmentEmailsConfig, LowStockConfig, QuietLeadsConfig, ShippingStep, ShippingUpdatesConfig, StageRule, StageTasksConfig, TaskPriority } from "@/lib/client/types";

const clampInt = (raw: string, min: number, max: number) => Math.min(max, Math.max(min, Math.floor(Number(raw) || 0)));

function SwitchRow({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <Checkbox className="mt-0.5" checked={checked} onCheckedChange={(c) => onChange(c === true)} />
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

function StageTasksCard({ initial }: { initial: StageTasksConfig }) {
  const save = useSaveAutomations();
  const [draft, setDraft] = useState<StageTasksConfig>(initial);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const setRule = (stage: keyof StageTasksConfig["stages"], patch: Partial<StageRule>) =>
    setDraft((d) => ({ ...d, stages: { ...d.stages, [stage]: { ...d.stages[stage], ...patch } } }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stage tasks</CardTitle>
        <CardDescription>
          When a deal moves into a stage, a task is created for the deal&apos;s owner. A deal gets one open task per stage, so moving a card back and forth does not pile them up. In the title you can use{" "}
          <code>{"{customer}"}</code>, <code>{"{deal}"}</code> and <code>{"{stage}"}</code>. A stage with no title does nothing.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SwitchRow checked={draft.enabled} onChange={(enabled) => setDraft((d) => ({ ...d, enabled }))} label="Create tasks when deals change stage" />
        <div className="space-y-3">
          {DEAL_STAGES.map((s) => {
            const rule = draft.stages[s.value];
            return (
              <div key={s.value} className="grid items-center gap-2 rounded-md border p-3 sm:grid-cols-[9rem_1fr_6rem_8rem]">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Checkbox checked={rule.enabled} disabled={!draft.enabled} onCheckedChange={(c) => setRule(s.value, { enabled: c === true })} aria-label={`Create a task for ${s.label}`} />
                  {s.label}
                </label>
                <Input
                  aria-label={`Task title for ${s.label}`}
                  placeholder="Task title (leave empty for none)"
                  maxLength={150}
                  value={rule.title}
                  disabled={!draft.enabled}
                  onChange={(e) => setRule(s.value, { title: e.target.value })}
                />
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Input
                    type="number"
                    min={0}
                    max={60}
                    aria-label={`Days until due for ${s.label}`}
                    className="h-9 w-16"
                    value={rule.dueInDays}
                    disabled={!draft.enabled}
                    onChange={(e) => setRule(s.value, { dueInDays: clampInt(e.target.value, 0, 60) })}
                  />
                  days
                </div>
                <Select value={rule.priority} disabled={!draft.enabled} onValueChange={(p) => setRule(s.value, { priority: p as TaskPriority })}>
                  <SelectTrigger aria-label={`Priority for ${s.label}`}>
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
              </div>
            );
          })}
        </div>
        <Button
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ stageTasks: draft }, { onSuccess: () => toast.success("Stage tasks saved"), onError: (e) => toast.error(errorMessage(e)) })}
        >
          {save.isPending ? "Saving…" : "Save stage tasks"}
        </Button>
      </CardContent>
    </Card>
  );
}

function QuietLeadsCard({ initial, wouldCreate }: { initial: QuietLeadsConfig; wouldCreate: number }) {
  const save = useSaveAutomations();
  const [draft, setDraft] = useState<QuietLeadsConfig>(initial);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quiet leads</CardTitle>
        <CardDescription>
          Once a day, every lead or prospect with nothing logged (on the contact or its deals) and no task completed for a number of days gets a follow-up task for its owner. Unqualified leads and contacts without an owner are skipped. A lead gets one open follow-up at a time. At most 500 tasks are created per run.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SwitchRow checked={draft.enabled} onChange={(enabled) => setDraft((d) => ({ ...d, enabled }))} label="Remind owners about quiet leads" />
        <label className="flex items-center gap-2 text-sm">
          Quiet for
          <Input
            type="number"
            min={1}
            max={90}
            aria-label="Days of silence before a follow-up task"
            className="h-9 w-20"
            value={draft.days}
            onChange={(e) => setDraft((d) => ({ ...d, days: clampInt(e.target.value, 1, 90) }))}
          />
          days
        </label>
        <p className="rounded-md border bg-muted/40 p-3 text-sm">
          {initial.enabled
            ? `On the next daily run, ${wouldCreate} lead${wouldCreate === 1 ? "" : "s"} would get a follow-up task.`
            : `If you switch this on, the first run would create ${wouldCreate} follow-up task${wouldCreate === 1 ? "" : "s"} (every lead quiet for ${initial.days}+ days, including any sample data). Save, then it starts with the next daily run.`}
        </p>
        <p className="text-xs text-muted-foreground">
          The daily run happens with the reminder emails. Hosted on Vercel it is automatic; on your own computer nothing triggers it until you schedule it (see TECHNICIAN.md).
        </p>
        <Button
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ quietLeads: draft }, { onSuccess: () => toast.success("Quiet-lead setting saved"), onError: (e) => toast.error(errorMessage(e)) })}
        >
          {save.isPending ? "Saving…" : "Save quiet leads"}
        </Button>
      </CardContent>
    </Card>
  );
}

function InstalmentEmailsCard({ initial, wouldSend, whatsappWouldSend }: { initial: InstalmentEmailsConfig; wouldSend: number; whatsappWouldSend: number }) {
  const save = useSaveAutomations();
  const sample = useSendSampleEmail();
  const [sampleKind, setSampleKind] = useState<"UPCOMING" | "OVERDUE_1" | "OVERDUE_2">("UPCOMING");
  const [draft, setDraft] = useState<InstalmentEmailsConfig>(initial);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const num = (k: "daysBefore" | "firstOverdueDays" | "secondOverdueDays", min: number, max: number) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((d) => ({ ...d, [k]: clampInt(e.target.value, min, max) }));
  const live = draft.mode === "LIVE";
  const wa = draft.whatsapp;
  const setWa = (part: Partial<typeof wa>) => setDraft((d) => ({ ...d, whatsapp: { ...d.whatsapp, ...part } }));
  const own = draft.wording[sampleKind];
  const setOwn = (part: Partial<typeof own>) => setDraft((d) => ({ ...d, wording: { ...d.wording, [sampleKind]: { ...d.wording[sampleKind], ...part } } }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Customer payment reminders</CardTitle>
        <CardDescription>
          Emails the customer about an instalment: a friendly reminder before it is due, a polite notice once it is late, and a firmer second notice. After the second notice the deal owner gets a &quot;call them&quot; task. Replies go to the deal owner. Nothing is sent for lost or deleted deals, for contacts without an email address or who are marked &quot;don&apos;t send automatic emails&quot;, for instalments already paid, or for instalments more than 30 days overdue.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SwitchRow checked={draft.enabled} onChange={(enabled) => setDraft((d) => ({ ...d, enabled }))} label="Send payment reminders to customers" />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="stack-y-1.5 text-sm">
            <span className="font-medium">Mode</span>
            <Select value={draft.mode} onValueChange={(m) => setDraft((d) => ({ ...d, mode: m as "TEST" | "LIVE" }))}>
              <SelectTrigger aria-label="Mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TEST">Test: send every email to me instead</SelectItem>
                <SelectItem value="LIVE">Live: send to customers</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="stack-y-1.5 text-sm">
            <span className="font-medium">Sender name</span>
            <Input value={draft.brandName} maxLength={60} onChange={(e) => setDraft((d) => ({ ...d, brandName: e.target.value }))} />
          </label>
        </div>
        <label className="block stack-y-1.5 text-sm">
          <span className="font-medium">{live ? "Send samples to" : "Send test emails to"}</span>
          <Input type="email" placeholder="you@example.com" value={draft.testEmail} onChange={(e) => setDraft((d) => ({ ...d, testEmail: e.target.value }))} />
          <span className="block text-xs text-muted-foreground">
            {live
              ? "Used only for the sample emails below."
              : "Required in test mode. Each email is marked [TEST] and says who would really have received it. Nothing is logged on the customer or the deal, and no tasks are created."}
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <label className="flex items-center gap-2">
            Reminder
            <Input type="number" min={0} max={14} aria-label="Days before the due date" className="h-9 w-16" value={draft.daysBefore} onChange={num("daysBefore", 0, 14)} />
            days before it is due
          </label>
          <label className="flex items-center gap-2">
            Overdue notices after
            <Input type="number" min={1} max={30} aria-label="Days until the first overdue notice" className="h-9 w-16" value={draft.firstOverdueDays} onChange={num("firstOverdueDays", 1, 30)} />
            and
            <Input type="number" min={2} max={60} aria-label="Days until the second overdue notice" className="h-9 w-16" value={draft.secondOverdueDays} onChange={num("secondOverdueDays", 2, 60)} />
            days
          </label>
        </div>
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Your own wording (optional)</p>
          <p className="text-xs text-muted-foreground">
            Pick a notice with the list below, then write your own subject and message. Leave a box empty to keep the built-in text. The greeting (&quot;Hi Name,&quot;), the Pay now button and the sign-off are always added. You can use{" "}
            <code>{"{name}"}</code>, <code>{"{amount}"}</code>, <code>{"{deal}"}</code>, <code>{"{dueDate}"}</code> and <code>{"{daysLate}"}</code>; they are filled in for each customer.
          </p>
          <Select value={sampleKind} onValueChange={(k) => setSampleKind(k as typeof sampleKind)}>
            <SelectTrigger className="w-64" aria-label="Which notice to word">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="UPCOMING">Reminder before it is due</SelectItem>
              <SelectItem value="OVERDUE_1">First overdue notice</SelectItem>
              <SelectItem value="OVERDUE_2">Second overdue notice</SelectItem>
            </SelectContent>
          </Select>
          <Input aria-label="Your subject" placeholder="Built-in subject" maxLength={150} value={own.subject} onChange={(e) => setOwn({ subject: e.target.value })} />
          <Textarea aria-label="Your message" placeholder="Built-in message" rows={5} maxLength={2000} value={own.message} onChange={(e) => setOwn({ message: e.target.value })} />
        </div>
        <div className="space-y-3 rounded-md border p-3">
          <SwitchRow checked={wa.enabled} onChange={(enabled) => setWa({ enabled })} label="Also send these reminders on WhatsApp" />
          <p className="text-xs text-muted-foreground">
            Sent on the same days as the emails, only to customers whose contact has &quot;agreed to receive WhatsApp messages&quot; ticked and a WhatsApp-ready phone number. WhatsApp only lets a business start a conversation with a message template Meta has approved, so create the three templates in Meta first (the steps and wording are in HANDOVER.md) and enter their names below. In test mode every message goes to the test number.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="stack-y-1.5 text-sm">
              <span className="font-medium">{live ? "WhatsApp test number" : "Send WhatsApp tests to"}</span>
              <Input placeholder="+2348012345678" value={wa.testPhone} onChange={(e) => setWa({ testPhone: e.target.value })} />
            </label>
            <label className="stack-y-1.5 text-sm">
              <span className="font-medium">Template language</span>
              <Input placeholder="en" value={wa.language} maxLength={6} onChange={(e) => setWa({ language: e.target.value })} />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ["UPCOMING", "Template: before it is due"],
                ["OVERDUE_1", "Template: first overdue notice"],
                ["OVERDUE_2", "Template: second overdue notice"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="stack-y-1.5 text-sm">
                <span className="font-medium">{label}</span>
                <Input aria-label={label} value={wa.templates[k]} maxLength={200} onChange={(e) => setWa({ templates: { ...wa.templates, [k]: e.target.value } })} />
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {initial.whatsapp.enabled
              ? `On the next daily run, ${whatsappWouldSend} WhatsApp message${whatsappWouldSend === 1 ? "" : "s"} would be sent${initial.mode === "TEST" ? " to your test number" : " to customers"}.`
              : `If you switch WhatsApp on with the saved settings, the first run would send ${whatsappWouldSend} message${whatsappWouldSend === 1 ? "" : "s"}.`}
          </p>
        </div>
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Check the wording now</p>
          <p className="text-xs text-muted-foreground">
            Sends one sample email with made-up details to the address above, using the sender name and wording above (they need not be saved first). Nothing is recorded and no customer is emailed.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={sampleKind} onValueChange={(k) => setSampleKind(k as typeof sampleKind)}>
              <SelectTrigger className="w-64" aria-label="Which sample email">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="UPCOMING">Reminder before it is due</SelectItem>
                <SelectItem value="OVERDUE_1">First overdue notice</SelectItem>
                <SelectItem value="OVERDUE_2">Second overdue notice</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              disabled={!draft.testEmail.trim() || !draft.brandName.trim() || sample.isPending}
              onClick={() =>
                sample.mutate(
                  { to: draft.testEmail.trim(), brandName: draft.brandName.trim(), kind: sampleKind, wording: draft.wording[sampleKind] },
                  {
                    onSuccess: (r) =>
                      r.consoleOnly
                        ? toast.warning("No email provider is set up, so nothing was delivered. The email was only printed in the server window. See TECHNICIAN.md.")
                        : toast.success(`Sample sent to ${r.to}. Check that inbox (and spam).`),
                    onError: (e) => toast.error(errorMessage(e)),
                  },
                )
              }
            >
              {sample.isPending ? "Sending…" : "Send sample"}
            </Button>
          </div>
        </div>
        {live && (
          <p role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            Live mode emails your real customers. Run it in test mode first and read a few of the emails.
          </p>
        )}
        <p className="rounded-md border bg-muted/40 p-3 text-sm">
          {initial.enabled
            ? `On the next daily run, ${wouldSend} email${wouldSend === 1 ? "" : "s"} would be sent${initial.mode === "TEST" ? " to your test address" : " to customers"}.`
            : `If you switch this on with the saved settings, the first run would send ${wouldSend} email${wouldSend === 1 ? "" : "s"}${initial.mode === "TEST" ? " to your test address" : " to customers"}.`}
        </p>
        <Button
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ instalmentEmails: draft }, { onSuccess: () => toast.success("Payment reminder settings saved"), onError: (e) => toast.error(errorMessage(e)) })}
        >
          {save.isPending ? "Saving…" : "Save payment reminders"}
        </Button>
      </CardContent>
    </Card>
  );
}

function LowStockCard({ initial, lowNow }: { initial: LowStockConfig; lowNow: number }) {
  const save = useSaveAutomations();
  const [draft, setDraft] = useState<LowStockConfig>(initial);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Low-stock alerts</CardTitle>
        <CardDescription>
          Once a day, all active admins get one email listing the stock items that have dropped to or below their alert level. An item is mentioned once per dip: it is emailed again only after it has been restocked above its level. Stock is counted for the whole business. An admin can give any item its own level (or switch it off) with the bell button on the Stock page. The Stock page marks low items whether or not the email is on.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SwitchRow checked={draft.enabled} onChange={(enabled) => setDraft((d) => ({ ...d, enabled }))} label="Email admins when stock runs low" />
        <label className="flex items-center gap-2 text-sm">
          Low at
          <Input
            type="number"
            min={0}
            max={100000}
            aria-label="Default low-stock level in pieces"
            className="h-9 w-24"
            value={draft.defaultThreshold}
            onChange={(e) => setDraft((d) => ({ ...d, defaultThreshold: clampInt(e.target.value, 0, 100000) }))}
          />
          pieces or fewer (0 = no default; only items with their own level are watched)
        </label>
        <p className="rounded-md border bg-muted/40 p-3 text-sm">
          {initial.enabled
            ? `${lowNow} item${lowNow === 1 ? " is" : "s are"} low right now. Items that have not been alerted yet are included in the next daily email.`
            : `If you switch this on, ${lowNow} item${lowNow === 1 ? " is" : "s are"} already at or below the saved level (including any sample data), so the first email would list ${lowNow === 1 ? "it" : "them"}. Save, then it starts with the next daily run.`}
        </p>
        <Button
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ lowStock: draft }, { onSuccess: () => toast.success("Low-stock setting saved"), onError: (e) => toast.error(errorMessage(e)) })}
        >
          {save.isPending ? "Saving…" : "Save low-stock alerts"}
        </Button>
      </CardContent>
    </Card>
  );
}

function ShippingStepRow({ label, step, onChange, templates }: { label: string; step: ShippingStep; onChange: (s: ShippingStep) => void; templates: { id: string; name: string; language: string }[] }) {
  return (
    <div className="space-y-2">
      <SwitchRow checked={step.enabled} onChange={(enabled) => onChange({ ...step, enabled })} label={label} />
      {step.enabled && (
        <Select value={step.templateId} onValueChange={(templateId) => onChange({ ...step, templateId })}>
          <SelectTrigger className="ml-7 w-72 max-w-full" aria-label={`Template for ${label}`}>
            <SelectValue placeholder={templates.length ? "Choose a template" : "No suitable template yet"} />
          </SelectTrigger>
          <SelectContent>
            {templates.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name} ({t.language})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function ShippingUpdatesCard({ initial }: { initial: ShippingUpdatesConfig }) {
  const save = useSaveAutomations();
  const { data: all } = useWhatsappTemplates();
  const [draft, setDraft] = useState<ShippingUpdatesConfig>(initial);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  // Only templates every blank of which can be filled by itself: nobody is there to type a value.
  const templates = (all ?? []).filter((t) => t.active && t.status === "APPROVED" && t.supported && t.slots.every((s) => s.source !== "manual"));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Shipping updates on WhatsApp</CardTitle>
        <CardDescription>
          When someone marks an order Shipped or Delivered, the chosen approved template is sent to the customer on WhatsApp by itself, with no one pressing Send. It goes only to customers who agreed to WhatsApp messages, once per order and step, and is logged on their timeline. If it cannot be sent, a note on the order says why. Templates with a blank that must be typed by hand are not listed. A tracking-number blank fills itself from the order, so mark it Shipped after saving the tracking number. Off by default.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SwitchRow checked={draft.enabled} onChange={(enabled) => setDraft((d) => ({ ...d, enabled }))} label="Send shipping updates automatically" />
        {draft.enabled && (
          <>
            <ShippingStepRow label="When an order is marked Shipped" step={draft.shipped} templates={templates} onChange={(shipped) => setDraft((d) => ({ ...d, shipped }))} />
            <ShippingStepRow label="When an order is marked Delivered" step={draft.delivered} templates={templates} onChange={(delivered) => setDraft((d) => ({ ...d, delivered }))} />
          </>
        )}
        <Button
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ shippingUpdates: draft }, { onSuccess: () => toast.success("Shipping updates saved"), onError: (e) => toast.error(errorMessage(e)) })}
        >
          {save.isPending ? "Saving…" : "Save shipping updates"}
        </Button>
      </CardContent>
    </Card>
  );
}

export function AutomationsCard() {
  const { data, isLoading, error, refetch } = useAutomations();
  if (isLoading) return <Skeleton className="h-64" />;
  if (error || !data) return <ErrorState message={error?.message} onRetry={() => refetch()} />;
  return <AutomationsForms data={data} />;
}

// Keyed by the saved values so the drafts reset to what was just saved.
function AutomationsForms({ data }: { data: AutomationsView }) {
  return (
    <div className="space-y-6">
      <StageTasksCard key={JSON.stringify(data.stageTasks)} initial={data.stageTasks} />
      <QuietLeadsCard key={JSON.stringify(data.quietLeads)} initial={data.quietLeads} wouldCreate={data.quietLeadsWouldCreate} />
      <InstalmentEmailsCard key={JSON.stringify(data.instalmentEmails)} initial={data.instalmentEmails} wouldSend={data.instalmentEmailsWouldSend} whatsappWouldSend={data.instalmentWhatsappsWouldSend} />
      <LowStockCard key={JSON.stringify(data.lowStock)} initial={data.lowStock} lowNow={data.lowStockNow} />
      <ShippingUpdatesCard key={JSON.stringify(data.shippingUpdates)} initial={data.shippingUpdates} />
    </div>
  );
}
