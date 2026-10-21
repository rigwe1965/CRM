"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/common/page";
import { fullName } from "@/lib/client/format";
import { useDuplicates, useList, useMergeContact } from "@/lib/client/hooks";
import type { Contact } from "@/lib/client/types";
import { FormShell, useFormState } from "./form-kit";

/** Admin: pick the contact to keep; this one's deals, activities, tasks and tags move onto it, and this one is removed. */
export function MergeContactDialog({ contact, onClose, onMerged }: { contact: Contact; onClose: () => void; onMerged: (keptId: string) => void }) {
  const merge = useMergeContact();
  const form = useFormState();
  const [intoId, setIntoId] = useState("");
  const likely = useDuplicates({ firstName: contact.firstName, lastName: contact.lastName, phone: contact.phone ?? "", email: "", excludeId: contact.id });
  const all = useList<Contact>("contacts", { pageSize: 100, sort: "name", order: "asc" });
  const options = new Map<string, string>();
  for (const d of likely.data ?? []) options.set(d.id, `${fullName(d)} (likely match)`);
  for (const c of all.data?.data ?? []) if (c.id !== contact.id && !options.has(c.id)) options.set(c.id, fullName(c));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <FormShell
          title={`Merge ${fullName(contact)}`}
          description="Choose the contact to keep. Everything on this one (deals, activities, tasks, tags) moves onto it, any empty details are filled in, and this contact is removed."
          submitLabel="Merge contacts"
          pendingLabel="Merging…"
          pending={merge.isPending}
          formError={form.formError}
          onCancel={onClose}
          onSubmit={async () => {
            if (!intoId) return toast.error("Choose the contact to keep");
            const ok = await form.run(() => merge.mutateAsync({ id: contact.id, intoId }));
            if (ok) {
              toast.success("Contacts merged");
              onMerged(intoId);
            }
          }}
        >
          <FormField label="Keep this contact" error={form.err("intoId")} hint="Likely matches are listed first.">
            <Select value={intoId} onValueChange={setIntoId}>
              <SelectTrigger>
                <SelectValue placeholder={all.isLoading ? "Loading…" : "Select a contact"} />
              </SelectTrigger>
              <SelectContent>
                {[...options].map(([id, label]) => (
                  <SelectItem key={id} value={id}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </FormShell>
      </DialogContent>
    </Dialog>
  );
}
