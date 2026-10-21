"use client";

import { useState } from "react";
import { FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog, EmptyState, ErrorState, FormField } from "@/components/common/page";
import { FormShell, useFormState } from "@/components/forms/form-kit";
import { errorMessage, useDeleteEmailTemplate, useEmailTemplates, useSaveEmailTemplate } from "@/lib/client/hooks";
import type { EmailTemplate } from "@/lib/client/types";

const WORDS = "{firstName}, {lastName}, {company} and {senderName}";

const STARTERS = [
  {
    name: "Quote",
    subject: "Your Ivycandy Hair quote",
    body: "Hi {firstName},\n\nThank you for your interest. Here is the quote we discussed: [add the items and prices].\n\nLet me know if you would like to go ahead and I will send the payment details.\n\n{senderName}",
  },
  {
    name: "Payment reminder",
    subject: "A reminder about your payment",
    body: "Hi {firstName},\n\nA quick reminder that your next instalment is coming due. If you have already paid, thank you, and please ignore this message.\n\nReply here if you have any questions.\n\n{senderName}",
  },
  {
    name: "Shipping update",
    subject: "Your order is on its way",
    body: "Hi {firstName},\n\nGood news: your order has shipped. Tracking number: [add the tracking number].\n\nPlease let me know when it arrives.\n\n{senderName}",
  },
];

function TemplateForm({ template, onClose }: { template?: EmailTemplate; onClose: () => void }) {
  const save = useSaveEmailTemplate(template?.id);
  const form = useFormState();
  const [v, setV] = useState({ name: template?.name ?? "", subject: template?.subject ?? "", body: template?.body ?? "" });

  return (
    <FormShell
      title={template ? "Edit template" : "New template"}
      description={`You can use ${WORDS}. They are filled in when someone picks the template. Words in [square brackets] are for you to replace before sending.`}
      submitLabel={template ? "Save changes" : "Create template"}
      pending={save.isPending}
      formError={form.formError}
      onCancel={onClose}
      onSubmit={async () => {
        const ok = await form.run(() => save.mutateAsync(v));
        if (ok) {
          toast.success(template ? "Template saved" : "Template created");
          onClose();
        }
      }}
    >
      <FormField label="Name" error={form.err("name")}>
        <Input value={v.name} maxLength={80} onChange={(e) => setV((s) => ({ ...s, name: e.target.value }))} autoFocus />
      </FormField>
      <FormField label="Subject" error={form.err("subject")}>
        <Input value={v.subject} maxLength={200} onChange={(e) => setV((s) => ({ ...s, subject: e.target.value }))} />
      </FormField>
      <FormField label="Message" error={form.err("body")}>
        <Textarea value={v.body} rows={9} maxLength={10000} onChange={(e) => setV((s) => ({ ...s, body: e.target.value }))} />
      </FormField>
    </FormShell>
  );
}

export function EmailTemplatesCard() {
  const { data, isLoading, error, refetch } = useEmailTemplates();
  const create = useSaveEmailTemplate();
  const del = useDeleteEmailTemplate();
  const [editing, setEditing] = useState<{ open: boolean; template?: EmailTemplate }>({ open: false });
  const [deleting, setDeleting] = useState<EmailTemplate | null>(null);
  const [adding, setAdding] = useState(false);

  async function addStarters() {
    setAdding(true);
    try {
      for (const s of STARTERS) await create.mutateAsync(s);
      toast.success("Starter templates added");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setAdding(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Email templates</CardTitle>
          <CardDescription>
            Ready-made wording for the &quot;Send email&quot; button on a contact. Everyone can use them; only admins change them. You can use {WORDS}.
          </CardDescription>
        </div>
        <Button onClick={() => setEditing({ open: true })}>
          <Plus /> New template
        </Button>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        {isLoading ? (
          <Skeleton className="mx-5 h-24" />
        ) : error || !data ? (
          <ErrorState message={error?.message} onRetry={() => refetch()} />
        ) : data.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No templates yet"
            description="Add a few common messages so the team does not retype them."
            action={
              <Button variant="outline" disabled={adding} onClick={addStarters}>
                {adding ? "Adding…" : "Add starter templates"}
              </Button>
            }
            className="py-10"
          />
        ) : (
          <ul className="divide-y">
            {data.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{t.name}</p>
                  <p className="truncate text-sm text-muted-foreground">{t.subject}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon" aria-label={`Edit ${t.name}`} onClick={() => setEditing({ open: true, template: t })}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`Delete ${t.name}`} onClick={() => setDeleting(t)}>
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={editing.open} onOpenChange={(o) => !o && setEditing({ open: false })}>
        <DialogContent>{editing.open && <TemplateForm template={editing.template} onClose={() => setEditing({ open: false })} />}</DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete template?"
        description={`"${deleting?.name ?? ""}" will be removed for everyone. Emails already sent are not affected.`}
        pending={del.isPending}
        onConfirm={() =>
          deleting &&
          del.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Template deleted");
              setDeleting(null);
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </Card>
  );
}
