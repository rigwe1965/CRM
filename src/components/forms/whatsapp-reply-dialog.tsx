"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { FormField } from "@/components/common/page";
import { fullName } from "@/lib/client/format";
import { useSendWhatsapp } from "@/lib/client/hooks";
import type { Contact } from "@/lib/client/types";
import { FormShell, useFormState } from "./form-kit";

/** Sends a WhatsApp message to the contact from inside the CRM; it is logged on their timeline. */
export function WhatsappReplyDialog({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const send = useSendWhatsapp(contact.id);
  const form = useFormState();
  const [message, setMessage] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <FormShell
          title={`WhatsApp ${fullName(contact)}`}
          description="Sent from your business WhatsApp number. You can reply freely for 24 hours after they last wrote to you."
          submitLabel="Send"
          pendingLabel="Sending…"
          pending={send.isPending}
          formError={form.formError}
          onCancel={onClose}
          onSubmit={async () => {
            const ok = await form.run(() => send.mutateAsync(message));
            if (ok) {
              toast.success("WhatsApp message sent");
              onClose();
            }
          }}
        >
          <FormField label="Message" error={form.err("message")}>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} maxLength={1000} autoFocus />
          </FormField>
        </FormShell>
      </DialogContent>
    </Dialog>
  );
}
