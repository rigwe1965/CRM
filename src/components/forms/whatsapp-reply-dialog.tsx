"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/common/page";
import { fullName } from "@/lib/client/format";
import { useSendWhatsapp, useSendWhatsappTemplate, useWhatsappTemplates } from "@/lib/client/hooks";
import type { Contact, Deal } from "@/lib/client/types";
import { renderBody } from "@/lib/whatsapp-template-slots";
import { FormShell, useFormState } from "./form-kit";

const DEAL_SOURCES = ["dealTitle", "amountDue", "dueDate", "orderLink"];

/** Free-text reply: only inside Meta's 24 hours after the customer last wrote. */
function FreeText({ contact, mode, onMode, onClose }: { contact: Contact; mode: Mode; onMode: Switcher; onClose: () => void }) {
  const send = useSendWhatsapp(contact.id);
  const form = useFormState();
  const [message, setMessage] = useState("");
  return (
    <FormShell
      title={`WhatsApp ${fullName(contact)}`}
      description="Sent from your business WhatsApp number. You can reply freely for 24 hours after they last wrote to you."
      submitLabel="Send"
      pendingLabel="Sending…"
      pending={send.isPending}
      formError={form.formError}
      onCancel={onClose}
      onSubmit={async () => {
        if (await form.run(() => send.mutateAsync(message))) {
          toast.success("WhatsApp message sent");
          onClose();
        }
      }}
    >
      {onMode(mode)}
      <FormField label="Message" error={form.err("message")}>
        <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} maxLength={1000} autoFocus />
      </FormField>
    </FormShell>
  );
}

/** An approved template: works at any time, but only for a customer who agreed to WhatsApp messages. */
function Template({ contact, deals, initialDealId, mode, onMode, onClose }: { contact: Contact; deals: Deal[]; initialDealId?: string; mode: Mode; onMode: Switcher; onClose: () => void }) {
  const { data, isLoading } = useWhatsappTemplates();
  const send = useSendWhatsappTemplate(contact.id);
  const form = useFormState();
  const [templateId, setTemplateId] = useState("");
  const [dealId, setDealId] = useState(initialDealId ?? "");
  const [typed, setTyped] = useState<Record<number, string>>({});

  const usable = (data ?? []).filter((t) => t.active && t.status === "APPROVED" && t.supported);
  const template = usable.find((t) => t.id === templateId);
  const chosenDeal = deals.find((d) => d.id === dealId);
  const needsDeal = !!template?.slots.some((s) => DEAL_SOURCES.includes(s.source));
  // A tracking number saved on the chosen order fills itself in; only when there is none is it typed.
  const fromOrder = (s: { source: string }) => s.source === "trackingNumber" && !!chosenDeal?.trackingNumber;
  const showDealPicker = needsDeal || !!template?.slots.some((s) => s.source === "trackingNumber");
  const preview = template
    ? renderBody(template.body, template.slots.map((s, i) => (s.source === "firstName" ? contact.firstName : fromOrder(s) ? chosenDeal!.trackingNumber! : typed[i]?.trim() || `[${s.label}]`)))
    : "";

  return (
    <FormShell
      title={`WhatsApp ${fullName(contact)}`}
      description="An approved message template. It can be sent at any time, and is logged on the contact."
      submitLabel="Send template"
      pendingLabel="Sending…"
      pending={send.isPending}
      formError={form.formError}
      onCancel={onClose}
      onSubmit={async () => {
        if (!template) return;
        const values = template.slots.map((_, i) => typed[i] ?? "");
        if (await form.run(() => send.mutateAsync({ templateId: template.id, dealId: showDealPicker ? dealId || undefined : undefined, values }))) {
          toast.success("WhatsApp template sent");
          onClose();
        }
      }}
    >
      {onMode(mode)}
      {!isLoading && usable.length === 0 ? (
        <p className="text-sm text-muted-foreground">No templates are switched on yet. An admin can copy them from Meta and switch them on under Settings → Templates.</p>
      ) : (
        <FormField label="Template" error={form.err("templateId")}>
          <Select value={templateId} onValueChange={(v) => { setTemplateId(v); setTyped({}); }}>
            <SelectTrigger>
              <SelectValue placeholder={isLoading ? "Loading…" : "Choose a template"} />
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
      )}
      {template && showDealPicker && (
        <FormField label={needsDeal ? "Which order is it about?" : "Which order? (fills in the tracking number)"} error={form.err("dealId")}>
          <Select value={dealId} onValueChange={setDealId}>
            <SelectTrigger>
              <SelectValue placeholder={deals.length ? "Choose an order" : "This contact has no orders"} />
            </SelectTrigger>
            <SelectContent>
              {deals.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      )}
      {template?.slots.map((s, i) =>
        s.source === "manual" || (s.source === "trackingNumber" && !fromOrder(s)) ? (
          <FormField key={i} label={s.label} error={form.err(`values.${i}`)}>
            <Input value={typed[i] ?? ""} maxLength={200} onChange={(e) => setTyped((all) => ({ ...all, [i]: e.target.value }))} />
          </FormField>
        ) : null,
      )}
      {template && <p className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm">{preview}</p>}
    </FormShell>
  );
}

type Mode = "text" | "template";
type Switcher = (current: Mode) => React.ReactNode;

/**
 * Sends a WhatsApp message to the contact from inside the CRM; it is logged on their timeline. A free-text reply is
 * possible for 24 hours after they last wrote; an approved template is possible any time (if they agreed to WhatsApp).
 */
export function WhatsappReplyDialog({ contact, deals, canText, canTemplate, initialDealId, startWithTemplate, onClose }: { contact: Contact; deals: Deal[]; canText: boolean; canTemplate: boolean; initialDealId?: string; startWithTemplate?: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>(canText && !(startWithTemplate && canTemplate) ? "text" : "template");
  const tabs: Switcher = (current) =>
    canText && canTemplate ? (
      <div className="flex gap-2">
        <Button type="button" size="sm" variant={current === "text" ? "default" : "outline"} onClick={() => setMode("text")}>
          Free text
        </Button>
        <Button type="button" size="sm" variant={current === "template" ? "default" : "outline"} onClick={() => setMode("template")}>
          Template
        </Button>
      </div>
    ) : null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {mode === "text" ? <FreeText contact={contact} mode={mode} onMode={tabs} onClose={onClose} /> : <Template contact={contact} deals={deals} initialDealId={initialDealId} mode={mode} onMode={tabs} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}
