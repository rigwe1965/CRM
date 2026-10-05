"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/common/page";
import { OrganizationPicker } from "@/components/common/pickers";
import { CONTACT_TYPES, LEAD_STATUSES } from "@/lib/client/constants";
import { useSave, useSendContactEmail } from "@/lib/client/hooks";
import type { Contact, ContactType, LeadStatus, Organization } from "@/lib/client/types";
import { FormShell, Grid2, nullable, useFormState } from "./form-kit";

// ─── Contact ────────────────────────────────────────────

export function ContactDialog({
  open,
  onOpenChange,
  contact,
  defaults,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contact?: Contact;
  defaults?: { organizationId?: string | null; type?: ContactType };
  onSaved?: (c: Contact) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <ContactForm contact={contact} defaults={defaults} onClose={() => onOpenChange(false)} onSaved={onSaved} />
      </DialogContent>
    </Dialog>
  );
}

function ContactForm({
  contact,
  defaults,
  onClose,
  onSaved,
}: {
  contact?: Contact;
  defaults?: { organizationId?: string | null; type?: ContactType };
  onClose: () => void;
  onSaved?: (c: Contact) => void;
}) {
  const save = useSave<Contact>("contacts", contact?.id);
  const form = useFormState();
  const [v, setV] = useState({
    firstName: contact?.firstName ?? "",
    lastName: contact?.lastName ?? "",
    email: contact?.email ?? "",
    phone: contact?.phone ?? "",
    title: contact?.title ?? "",
    source: contact?.source ?? "",
    type: (contact?.type ?? defaults?.type ?? "LEAD") as ContactType,
    leadStatus: (contact?.leadStatus ?? "NEW") as LeadStatus,
    organizationId: (contact?.organizationId ?? defaults?.organizationId ?? null) as string | null,
  });
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));
  const isLeadish = v.type === "LEAD" || v.type === "PROSPECT";

  return (
    <FormShell
      title={contact ? "Edit contact" : "New contact"}
      description={contact ? undefined : "Add a lead, prospect or customer."}
      submitLabel={contact ? "Save changes" : "Create contact"}
      pending={save.isPending}
      formError={form.formError}
      onCancel={onClose}
      onSubmit={async () => {
        let saved: Contact | undefined;
        const ok = await form.run(async () => {
          saved = await save.mutateAsync({
            firstName: v.firstName,
            lastName: v.lastName,
            email: nullable(v.email),
            phone: nullable(v.phone),
            title: nullable(v.title),
            source: nullable(v.source),
            type: v.type,
            leadStatus: isLeadish ? v.leadStatus : null,
            organizationId: v.organizationId,
          });
        });
        if (ok) {
          toast.success(contact ? "Contact updated" : "Contact created");
          if (saved) onSaved?.(saved);
          onClose();
        }
      }}
    >
      <Grid2>
        <FormField label="First name" error={form.err("firstName")}>
          <Input value={v.firstName} onChange={(e) => set("firstName", e.target.value)} aria-invalid={!!form.err("firstName")} autoFocus />
        </FormField>
        <FormField label="Last name" error={form.err("lastName")}>
          <Input value={v.lastName} onChange={(e) => set("lastName", e.target.value)} aria-invalid={!!form.err("lastName")} />
        </FormField>
      </Grid2>
      <Grid2>
        <FormField label="Email" error={form.err("email")}>
          <Input type="email" value={v.email} onChange={(e) => set("email", e.target.value)} aria-invalid={!!form.err("email")} />
        </FormField>
        <FormField label="Phone" error={form.err("phone")}>
          <Input value={v.phone} onChange={(e) => set("phone", e.target.value)} aria-invalid={!!form.err("phone")} />
        </FormField>
      </Grid2>
      <Grid2>
        <FormField label="Job title" error={form.err("title")}>
          <Input value={v.title} onChange={(e) => set("title", e.target.value)} />
        </FormField>
        <FormField label="Company" error={form.err("organizationId")}>
          <OrganizationPicker
            value={v.organizationId}
            onChange={(id) => set("organizationId", id)}
            placeholder="Select a company"
            fallback={contact?.organization}
            invalid={!!form.err("organizationId")}
          />
        </FormField>
      </Grid2>
      <Grid2>
        <FormField label="Type">
          <Select value={v.type} onValueChange={(t) => set("type", t as ContactType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONTACT_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        {isLeadish ? (
          <FormField label="Lead status">
            <Select value={v.leadStatus} onValueChange={(s) => set("leadStatus", s as LeadStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAD_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        ) : (
          <FormField label="Source">
            <Input value={v.source} onChange={(e) => set("source", e.target.value)} placeholder="Referral, website…" />
          </FormField>
        )}
      </Grid2>
      {isLeadish && (
        <FormField label="Source">
          <Input value={v.source} onChange={(e) => set("source", e.target.value)} placeholder="Referral, website…" />
        </FormField>
      )}
    </FormShell>
  );
}

// ─── Organization ───────────────────────────────────────

export function OrganizationDialog({
  open,
  onOpenChange,
  organization,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  organization?: Organization;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <OrganizationForm organization={organization} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function OrganizationForm({ organization: org, onClose }: { organization?: Organization; onClose: () => void }) {
  const save = useSave<Organization>("organizations", org?.id);
  const form = useFormState();
  const [v, setV] = useState({
    name: org?.name ?? "",
    domain: org?.domain ?? "",
    industry: org?.industry ?? "",
    size: org?.size?.toString() ?? "",
    website: org?.website ?? "",
    phone: org?.phone ?? "",
    address: org?.address ?? "",
    city: org?.city ?? "",
    state: org?.state ?? "",
    country: org?.country ?? "",
  });
  const set = (k: keyof typeof v, val: string) => setV((s) => ({ ...s, [k]: val }));
  const text = (k: keyof typeof v, label: string, placeholder?: string) => (
    <FormField label={label} error={form.err(k)}>
      <Input value={v[k]} onChange={(e) => set(k, e.target.value)} placeholder={placeholder} aria-invalid={!!form.err(k)} />
    </FormField>
  );

  return (
    <FormShell
      title={org ? "Edit company" : "New company"}
      description={org ? undefined : "Add a company you sell to or work with."}
      submitLabel={org ? "Save changes" : "Create company"}
      pending={save.isPending}
      formError={form.formError}
      onCancel={onClose}
      onSubmit={async () => {
        const size = v.size.trim() === "" ? null : Number(v.size);
        const ok = await form.run(() =>
          save.mutateAsync({
            name: v.name,
            domain: nullable(v.domain),
            industry: nullable(v.industry),
            size: Number.isNaN(size) ? null : size,
            website: nullable(v.website),
            phone: nullable(v.phone),
            address: nullable(v.address),
            city: nullable(v.city),
            state: nullable(v.state),
            country: nullable(v.country),
          }),
        );
        if (ok) {
          toast.success(org ? "Company updated" : "Company created");
          onClose();
        }
      }}
    >
      <FormField label="Name" error={form.err("name")}>
        <Input value={v.name} onChange={(e) => set("name", e.target.value)} aria-invalid={!!form.err("name")} autoFocus />
      </FormField>
      <Grid2>
        {text("domain", "Domain", "acme.com")}
        {text("industry", "Industry")}
      </Grid2>
      <Grid2>
        {text("website", "Website", "https://acme.com")}
        {text("phone", "Phone")}
      </Grid2>
      <Grid2>
        <FormField label="Employees" error={form.err("size")}>
          <Input type="number" min={0} value={v.size} onChange={(e) => set("size", e.target.value)} />
        </FormField>
        {text("address", "Address")}
      </Grid2>
      <Grid2>
        {text("city", "City")}
        {text("state", "State / region")}
      </Grid2>
      {text("country", "Country")}
    </FormShell>
  );
}

// ─── Email a contact ────────────────────────────────────

export function EmailContactDialog({
  open,
  onOpenChange,
  contact,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contact: Pick<Contact, "id" | "firstName" | "email">;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <EmailContactForm contact={contact} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function EmailContactForm({ contact, onClose }: { contact: Pick<Contact, "id" | "firstName" | "email">; onClose: () => void }) {
  const send = useSendContactEmail(contact.id);
  const form = useFormState();
  const [v, setV] = useState({ subject: "", message: "" });

  return (
    <FormShell
      title={`Email ${contact.firstName}`}
      description={`Sent to ${contact.email}. Replies go to your own address, and the email is logged on the timeline.`}
      submitLabel="Send email"
      pendingLabel="Sending…"
      pending={send.isPending}
      formError={form.formError}
      onCancel={onClose}
      onSubmit={async () => {
        const ok = await form.run(() => send.mutateAsync(v));
        if (ok) {
          toast.success(`Email sent to ${contact.email}`);
          onClose();
        }
      }}
    >
      <FormField label="Subject" error={form.err("subject")}>
        <Input value={v.subject} maxLength={200} onChange={(e) => setV((s) => ({ ...s, subject: e.target.value }))} autoFocus />
      </FormField>
      <FormField label="Message" error={form.err("message")}>
        <Textarea value={v.message} rows={8} maxLength={10000} onChange={(e) => setV((s) => ({ ...s, message: e.target.value }))} />
      </FormField>
    </FormShell>
  );
}
